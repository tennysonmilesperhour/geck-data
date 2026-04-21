"use client";
// Growth tab — "Is growth accelerating?" and "Is engagement real?"
//
// Adapted from the source Analytics page. Because geck-inspect is mostly
// browse-only (users don't create forum posts or geckos), the KPI row swaps
// in market-data throughput (new listings, price drops, sold, cross-platform,
// show mentions) as the main activity signal alongside new signups. Images
// and alerts stand in as the per-user content signals.
import { useMemo } from "react";
import KpiCard from "@/components/ui/KpiCard";
import { Panel } from "@/components/ui/Panel";
import { AreaChart, BarChart, HBarChart, LineMulti, PALETTE } from "./charts";
import {
  DAY_MS,
  activeUsersInWindow,
  cumulative,
  daySeries,
  deltaFromWindow,
  windowFor,
} from "./aggregations";
import type { DataBundle, Period } from "./types";

export default function GrowthTab({
  data,
  period,
}: {
  data: DataBundle | null;
  period: Period;
}) {
  const agg = useMemo(() => (data ? computeGrowth(data, period) : null), [data, period]);

  if (!data || !agg) return <Placeholder label="Loading growth metrics…" />;

  const { kpis, engagement, charts, power } = agg;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="New signups"
          value={kpis.signups.curr.toLocaleString()}
          delta={{ value: kpis.signups.pct, label: "vs prior" }}
          sub={`${kpis.signups.prev.toLocaleString()} prior`}
        />
        <KpiCard
          label="New listings"
          value={kpis.listings.curr.toLocaleString()}
          delta={{ value: kpis.listings.pct, label: "vs prior" }}
          sub={`${kpis.listings.prev.toLocaleString()} prior`}
          tone="info"
        />
        <KpiCard
          label="Price drops"
          value={kpis.drops.curr.toLocaleString()}
          delta={{ value: kpis.drops.pct, label: "vs prior" }}
          sub={`${kpis.drops.prev.toLocaleString()} prior`}
          tone="warn"
        />
        <KpiCard
          label="Sold"
          value={kpis.sold.curr.toLocaleString()}
          delta={{ value: kpis.sold.pct, label: "vs prior" }}
          sub={`${kpis.sold.prev.toLocaleString()} prior`}
          tone="positive"
        />
        <KpiCard
          label="Cross-platform"
          value={kpis.cross.curr.toLocaleString()}
          delta={{ value: kpis.cross.pct, label: "vs prior" }}
          sub={`${kpis.cross.prev.toLocaleString()} prior`}
        />
        <KpiCard
          label="Show mentions"
          value={kpis.shows.curr.toLocaleString()}
          delta={{ value: kpis.shows.pct, label: "vs prior" }}
          sub={`${kpis.shows.prev.toLocaleString()} prior`}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard
          label="Active users this period"
          value={engagement.activeUsers.toLocaleString()}
          sub={`${engagement.activePct}% of ${data.profiles.length.toLocaleString()} total`}
          tone="positive"
        />
        <KpiCard
          label="Cohort activation"
          value={`${engagement.activationPct}%`}
          sub={`${engagement.activated}/${engagement.signedUpInWindow} new users created an alert or uploaded`}
          tone="info"
        />
        <KpiCard
          label="Return rate"
          value={`${engagement.returnPct}%`}
          sub={`${engagement.returned}/${engagement.priorSignups} of prior-period signups came back`}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="User growth"
          subtitle="Cumulative signups. Seeded with accounts older than the first bucket."
        >
          <AreaChart data={charts.cumulativeSignups} color={PALETTE.emerald} />
        </Panel>
        <Panel
          title="Daily signups"
          subtitle="Net new accounts per day."
        >
          <BarChart data={charts.dailySignups} color={PALETTE.blue} />
        </Panel>
        <Panel
          title="Daily activity mix"
          subtitle="New listings, sold, price drops, images — per day."
        >
          <LineMulti series={charts.activityMix} />
        </Panel>
        <Panel
          title="Feature usage"
          subtitle="Records created in window, sorted."
        >
          <HBarChart items={charts.featureUsage} color={PALETTE.purple} />
        </Panel>
      </div>

      <Panel
        title="Power users"
        subtitle="Top contributors of per-user content (uploads + saved alerts)."
      >
        {power.length === 0 ? (
          <p className="text-sm text-ink-400">Not enough data yet.</p>
        ) : (
          <ul className="divide-y divide-ink-700/60 text-sm">
            {power.map((u, i) => (
              <li
                key={u.email}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="flex items-center gap-3">
                  <span className="w-5 text-right font-mono text-[11px] text-ink-500">
                    #{i + 1}
                  </span>
                  <span className="text-ink-100">{u.display}</span>
                  <span className="text-ink-500">{u.email}</span>
                </span>
                <span className="flex items-center gap-4 font-mono text-[11px] text-ink-400">
                  <span title="Images uploaded">📸 {u.images.toLocaleString()}</span>
                  <span title="Alerts created">🔔 {u.alerts.toLocaleString()}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800 p-8 text-sm text-ink-400">
      {label}
    </div>
  );
}

// ----------------------------------------------------------------------------
// computeGrowth — pure aggregation over the DataBundle. Kept outside the
// component so it can be reasoned about without React.
// ----------------------------------------------------------------------------
function computeGrowth(data: DataBundle, period: Period) {
  const { now, currStartMs, prevStartMs } = windowFor(period);

  const profileRows = data.profiles.map((p) => ({ t: p.created_at }));

  const signups = deltaFromWindow(profileRows, "t", currStartMs, prevStartMs, now);
  const listings = deltaFromWindow(data.newListings, "t", currStartMs, prevStartMs, now);
  const drops = deltaFromWindow(data.priceDrops, "t", currStartMs, prevStartMs, now);
  const sold = deltaFromWindow(data.sold, "t", currStartMs, prevStartMs, now);
  const cross = deltaFromWindow(data.crossPlatform, "t", currStartMs, prevStartMs, now);
  const shows = deltaFromWindow(data.showMentions, "t", currStartMs, prevStartMs, now);

  // Engagement strip.
  const active = activeUsersInWindow(
    data.profiles,
    data.listingImages,
    data.alerts,
    data.events,
    currStartMs,
    now,
  );
  const activePct =
    data.profiles.length === 0
      ? 0
      : Math.round((active.size / data.profiles.length) * 100);

  // Cohort activation: signed up in this window AND created ≥1 alert OR
  // uploaded ≥1 image.
  const profilesById = new Map(data.profiles.map((p) => [p.id, p]));
  const signedUpInWindowIds = new Set(
    data.profiles
      .filter((p) => {
        const t = Date.parse(p.created_at);
        return Number.isFinite(t) && t >= currStartMs && t <= now;
      })
      .map((p) => p.id),
  );
  const signedUpInWindow = signedUpInWindowIds.size;
  const activated = new Set<string>();
  for (const a of data.alerts) {
    if (!a.owner_id || !signedUpInWindowIds.has(a.owner_id)) continue;
    activated.add(a.owner_id);
  }
  for (const img of data.listingImages) {
    if (!img.uploaded_by || !signedUpInWindowIds.has(img.uploaded_by)) continue;
    activated.add(img.uploaded_by);
  }
  const activationPct =
    signedUpInWindow === 0 ? 0 : Math.round((activated.size / signedUpInWindow) * 100);

  // Return rate: of users who signed up in the *prior* period, what fraction
  // were active in the current period (by any signal that feeds `active`).
  const priorSignupIds = new Set(
    data.profiles
      .filter((p) => {
        const t = Date.parse(p.created_at);
        return Number.isFinite(t) && t >= prevStartMs && t < currStartMs;
      })
      .map((p) => p.id),
  );
  const priorSignups = priorSignupIds.size;
  const priorEmails = new Set(
    Array.from(priorSignupIds)
      .map((id) => profilesById.get(id)?.email ?? null)
      .filter((x): x is string => !!x),
  );
  let returned = 0;
  for (const email of priorEmails) if (active.has(email)) returned += 1;
  const returnPct = priorSignups === 0 ? 0 : Math.round((returned / priorSignups) * 100);

  // Charts. Buckets capped at min(period, 90) so the 365d view still plots.
  const buckets = Math.min(period, 90);
  const dailySignups = daySeries(profileRows, buckets, now);
  const seed = data.profiles.filter((p) => {
    const t = Date.parse(p.created_at);
    return Number.isFinite(t) && t < now - buckets * DAY_MS;
  }).length;
  const cumulativeSignups = cumulative(dailySignups, seed);

  const activityMix = [
    { name: "New listings", color: PALETTE.emerald, data: daySeries(data.newListings, buckets, now) },
    { name: "Sold",          color: PALETTE.blue,    data: daySeries(data.sold, buckets, now) },
    { name: "Price drops",   color: PALETTE.amber,   data: daySeries(data.priceDrops, buckets, now) },
    { name: "Images",        color: PALETTE.purple,  data: daySeries(data.listingImages, buckets, now) },
  ];

  const featureUsage = [
    { label: "Listings",       value: listings.curr },
    { label: "Sold",           value: sold.curr },
    { label: "Price drops",    value: drops.curr },
    { label: "Cross-platform", value: cross.curr },
    { label: "Show mentions",  value: shows.curr },
    { label: "Images",         value: countInWindow(data.listingImages, currStartMs, now) },
    { label: "Alerts",         value: countInWindow(data.alerts, currStartMs, now) },
  ].sort((a, b) => b.value - a.value);

  // Power users — top 8 by (images + alerts) in window.
  const byId = new Map<string, { images: number; alerts: number }>();
  for (const r of data.listingImages) {
    if (!r.uploaded_by) continue;
    const t = Date.parse(r.t);
    if (!Number.isFinite(t) || t < currStartMs || t > now) continue;
    const rec = byId.get(r.uploaded_by) ?? { images: 0, alerts: 0 };
    rec.images += 1;
    byId.set(r.uploaded_by, rec);
  }
  for (const r of data.alerts) {
    if (!r.owner_id) continue;
    const t = Date.parse(r.t);
    if (!Number.isFinite(t) || t < currStartMs || t > now) continue;
    const rec = byId.get(r.owner_id) ?? { images: 0, alerts: 0 };
    rec.alerts += 1;
    byId.set(r.owner_id, rec);
  }
  const power = Array.from(byId.entries())
    .map(([id, rec]) => {
      const p = profilesById.get(id);
      const email = p?.email ?? "unknown";
      const display = email.split("@")[0] ?? "unknown";
      return { id, email, display, ...rec, total: rec.images + rec.alerts };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  return {
    kpis: { signups, listings, drops, sold, cross, shows },
    engagement: {
      activeUsers: active.size,
      activePct,
      signedUpInWindow,
      activated: activated.size,
      activationPct,
      priorSignups,
      returned,
      returnPct,
    },
    charts: { dailySignups, cumulativeSignups, activityMix, featureUsage },
    power,
  };
}

function countInWindow(
  rows: Array<{ t: string }>,
  currStartMs: number,
  nowMs: number,
): number {
  let n = 0;
  for (const r of rows) {
    const t = Date.parse(r.t);
    if (Number.isFinite(t) && t >= currStartMs && t <= nowMs) n += 1;
  }
  return n;
}
