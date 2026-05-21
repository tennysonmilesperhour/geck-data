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
): Promise<{ sent: number; failed: number }> {
  if (matches.length === 0) return { sent: 0, failed: 0 };

  const ownerIds = Array.from(
    new Set(matches.map((m) => m.alert.owner_id).filter((id): id is string => !!id)),
  );
  if (ownerIds.length === 0) return { sent: 0, failed: 0 };

  const { data: channels } = await admin
    .from("user_notification_channels")
    .select("id, owner_id, kind, endpoint, enabled")
    .eq("enabled", true)
    .in("owner_id", ownerIds);
  if (!channels?.length) return { sent: 0, failed: 0 };

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
  await Promise.all(
    matches.flatMap((m) => {
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
      return dests.map(async (d) => {
        try {
          const ok = await sendTo(d, payload);
          if (ok) sent++;
          else failed++;
        } catch {
          failed++;
        }
      });
    }),
  );
  return { sent, failed };
}

async function sendTo(d: NotificationChannel, p: Payload): Promise<boolean> {
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
      return r.ok;
    }
    if (d.kind === "generic_webhook") {
      const r = await fetch(d.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
        signal: controller.signal,
      });
      return r.ok;
    }
    // Email channel: not wired up here. The presence of an "email" row in
    // user_notification_channels is honoured by a separate worker that
    // reads alert_matches and batches digests.
    return false;
  } finally {
    clearTimeout(timer);
  }
}
