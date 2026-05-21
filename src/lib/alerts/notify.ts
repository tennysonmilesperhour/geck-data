// Notification dispatcher for alert matches.
//
// Called from /api/ingest after evaluateAlerts() returns a non-empty list.
// Resolves each alert's owner to a notification destination — for now,
// either a Discord webhook URL or a generic JSON webhook — and POSTs a
// small payload. Failures are swallowed; we never block ingest on a
// downstream notifier.
//
// Destinations live in user_notification_channels (created in 0030).
//
// IMPORTANT: this runs inside the /api/ingest request lifecycle, so each
// dispatch is fire-and-forget with a hard 4s timeout. A slow webhook
// must not stretch the ingest p95.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertMatch } from "./matcher";

export type NotificationChannel = {
  id: string;
  owner_id: string | null;
  kind: "discord_webhook" | "generic_webhook" | "email";
  endpoint: string;
  enabled: boolean;
};

type Payload = {
  alert_id: string;
  alert_name: string;
  listing_id: string;
  price_usd: number | null;
  trigger: string;
  reason: string;
  url: string;
};

export async function dispatchMatches(
  admin: SupabaseClient,
  matches: AlertMatch[],
  listingId: string,
  priceUsd: number | null,
  trigger: string,
): Promise<{ sent: number; failed: number; snoozed: number }> {
  if (matches.length === 0) return { sent: 0, failed: 0, snoozed: 0 };

  // Honour per-alert snoozes (idea #9). A snoozed match still gets written
  // to alert_matches by the caller for completeness, but we don't fan out
  // a notification while snoozed_until is in the future. Look up the most
  // recent snooze per alert in one query.
  const alertIds = matches.map((m) => m.alert.id);
  const { data: snoozedRows } = await admin
    .from("alert_matches")
    .select("alert_id, snoozed_until")
    .in("alert_id", alertIds)
    .not("snoozed_until", "is", null)
    .gt("snoozed_until", new Date().toISOString());
  const snoozedAlertIds = new Set(
    ((snoozedRows ?? []) as { alert_id: string }[]).map((r) => r.alert_id),
  );
  const active = matches.filter((m) => !snoozedAlertIds.has(m.alert.id));
  const snoozedCount = matches.length - active.length;

  const ownerIds = Array.from(
    new Set(active.map((m) => m.alert.owner_id).filter((id): id is string => !!id)),
  );
  if (ownerIds.length === 0) return { sent: 0, failed: 0, snoozed: snoozedCount };

  const { data: channels } = await admin
    .from("user_notification_channels")
    .select("id, owner_id, kind, endpoint, enabled")
    .eq("enabled", true)
    .in("owner_id", ownerIds);
  if (!channels?.length) return { sent: 0, failed: 0, snoozed: snoozedCount };

  const byOwner = new Map<string, NotificationChannel[]>();
  for (const c of channels as NotificationChannel[]) {
    if (!c.owner_id) continue;
    const list = byOwner.get(c.owner_id) ?? [];
    list.push(c);
    byOwner.set(c.owner_id, list);
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://geck-data.vercel.app";
  let sent = 0;
  let failed = 0;
  // Resolve the match_id for each AlertMatch — needed for the delivery
  // attempts row. The caller wrote alert_matches just before; we look up
  // the freshly-inserted match by (alert_id, listing_id) ordered desc.
  const matchIdByAlert = await resolveMatchIds(admin, active.map((m) => m.alert.id), listingId);

  await Promise.all(
    active.flatMap((m) => {
      const dests = byOwner.get(m.alert.owner_id ?? "") ?? [];
      const payload: Payload = {
        alert_id: m.alert.id,
        alert_name: m.alert.name,
        listing_id: listingId,
        price_usd: priceUsd,
        trigger,
        reason: m.reason,
        url: `${base}/listings/${listingId}`,
      };
      const matchId = matchIdByAlert.get(m.alert.id);
      return dests.map(async (d) => {
        let ok = false;
        let httpStatus: number | null = null;
        let errorSummary: string | null = null;
        try {
          const res = await sendTo(d, payload);
          ok = res.ok;
          httpStatus = res.status;
          if (!ok) errorSummary = `HTTP ${res.status}`;
        } catch (e) {
          errorSummary = e instanceof Error ? e.message : String(e);
        }
        if (ok) sent++;
        else failed++;
        // Write a delivery attempt row. Best-effort: a delivery-receipt
        // logging failure must not block the actual notification path.
        if (matchId) {
          try {
            await admin.from("alert_delivery_attempts").insert({
              match_id: matchId,
              channel_id: d.id,
              attempt_no: 1,
              status: ok ? "sent" : "failed",
              http_status: httpStatus,
              error_summary: errorSummary?.slice(0, 500) ?? null,
            });
          } catch {
            // swallow
          }
        }
      });
    }),
  );
  return { sent, failed, snoozed: snoozedCount };
}

async function resolveMatchIds(
  admin: SupabaseClient,
  alertIds: string[],
  listingId: string,
): Promise<Map<string, string>> {
  if (alertIds.length === 0) return new Map();
  const { data } = await admin
    .from("alert_matches")
    .select("id, alert_id, matched_at")
    .in("alert_id", alertIds)
    .eq("listing_id", listingId)
    .order("matched_at", { ascending: false });
  const out = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; alert_id: string }[]) {
    if (!out.has(r.alert_id)) out.set(r.alert_id, r.id);
  }
  return out;
}

async function sendTo(
  d: NotificationChannel,
  p: Payload,
): Promise<{ ok: boolean; status: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    if (d.kind === "discord_webhook") {
      const body = {
        content: `🦎 **${p.alert_name}** — ${p.trigger} on ${p.listing_id}`,
        embeds: [
          {
            title: p.alert_name,
            url: p.url,
            description: p.reason,
            fields: [
              { name: "Listing", value: p.listing_id, inline: true },
              { name: "Price (USD)", value: p.price_usd != null ? `$${p.price_usd}` : "—", inline: true },
              { name: "Trigger", value: p.trigger, inline: true },
            ],
          },
        ],
      };
      const r = await fetch(d.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return { ok: r.ok, status: r.status };
    }
    if (d.kind === "generic_webhook") {
      const r = await fetch(d.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
        signal: controller.signal,
      });
      return { ok: r.ok, status: r.status };
    }
    // Email channel: not wired up here. The presence of an "email" row in
    // user_notification_channels is honoured by a separate worker that
    // reads alert_matches and batches digests.
    return { ok: false, status: null };
  } finally {
    clearTimeout(timer);
  }
}
