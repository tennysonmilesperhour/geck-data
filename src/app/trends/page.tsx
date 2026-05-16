// Market Trends — longitudinal view of the crested gecko market. The
// heavy trait-momentum computation (~20k listings, ~200ms) is lifted
// into a Suspense-wrapped child component so the rest of the page
// (cadence chart, weekly median, maturity cohorts) streams to the
// client as soon as those queries finish, rather than blocking on the
// momentum pass.
import { Suspense } from "react";
import { Panel, SectionHeader } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import DataFreshness from "@/components/ui/DataFreshness";
import TimeSeriesLine, {
  type ChartEvent,
  type Series,
  type SeriesPoint,
} from "@/components/charts/TimeSeriesLine";
import { chartTheme } from "@/components/charts/theme";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtPct, fmtUsd } from "@/lib/format";
import TraitMomentumPanels, {
  TraitMomentumSkeleton,
} from "@/components/trends/TraitMomentumPanels";
import ProfitabilityTiers, {
  ProfitabilityTiersSkeleton,
} from "@/components/trends/ProfitabilityTiers";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

function dayBucketISO(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function weekBucketISO(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

type CountRow = { t: string };
function series(
  rows: CountRow[],
  bucket: (iso: string) => string | null,
): SeriesPoint[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = bucket(r.t);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([k, v]) => ({ t: new Date(k + "T00:00:00Z"), v }))
    .sort((a, b) => a.t.getTime() - b.t.getTime());
}

function medianSeries(
  rows: Array<{ t: string; v: number }>,
  bucket: (iso: string) => string | null,
): SeriesPoint[] {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const k = bucket(r.t);
    if (!k) continue;
    const arr = map.get(k) ?? [];
    arr.push(r.v);
    map.set(k, arr);
  }
  const out: SeriesPoint[] = [];
  for (const [k, arr] of map) {
    arr.sort((a, b) => a - b);
    const m = arr[Math.floor(arr.length / 2)];
    out.push({ t: new Date(k + "T00:00:00Z"), v: m ?? 0 });
  }
  return out.sort((a, b) => a.t.getTime() - b.t.getTime());
}

export default async function TrendsPage() {
  const supabase = createClient();

  // 30d for the cadence chart (90d was dominated by the initial catalog
  // backfill spike, which made the rest of the timeline read as flat),
  // 90d kept for the price-history weekly median so it has enough
  // points to draw a line.
  const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const since90 = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const since14 = new Date(Date.now() - 14 * DAY_MS).toISOString();
  const prev14 = new Date(Date.now() - 28 * DAY_MS).toISOString();

  // Fast queries — these block the initial paint. The trait-momentum
  // computation (which needs the full 20k listings + a chunky double
  // groupBy) runs in <TraitMomentumPanels /> behind a Suspense boundary.
  const [
    newListingsRaw,
    priceDropsRaw,
    soldEventsRaw,
    priceHistoryRaw,
    listingsForMaturity,
    recentCount14,
    priorCount14,
  ] = await Promise.all([
    supabase
      .from("market_listings")
      .select("first_seen_at")
      .gte("first_seen_at", since30)
      .limit(20000),
    supabase
      .from("price_drops")
      .select("observed_at, pct_change")
      .gte("observed_at", since30)
      .limit(20000),
    supabase
      .from("listing_status_events")
      .select("observed_at")
      .eq("status", "sold")
      .gte("observed_at", since30)
      .limit(20000),
    supabase
      .from("price_history")
      .select("observed_at, price")
      .gte("observed_at", since90)
      .limit(20000),
    supabase
      .from("market_listings")
      .select("price, price_usd_equivalent, maturity")
      .limit(20000),
    supabase
      .from("market_listings")
      .select("id", { count: "exact", head: true })
      .gte("first_seen_at", since14),
    supabase
      .from("market_listings")
      .select("id", { count: "exact", head: true })
      .gte("first_seen_at", prev14)
      .lt("first_seen_at", since14),
  ]);

  const newListingsDaily = series(
    (newListingsRaw.data ?? []).map((r) => ({ t: r.first_seen_at as string })),
    dayBucketISO,
  );
  const priceDropsDaily = series(
    (priceDropsRaw.data ?? []).map((r) => ({ t: r.observed_at as string })),
    dayBucketISO,
  );
  const soldDaily = series(
    (soldEventsRaw.data ?? []).map((r) => ({ t: r.observed_at as string })),
    dayBucketISO,
  );
  const priceTicksDaily = series(
    (priceHistoryRaw.data ?? []).map((r) => ({ t: r.observed_at as string })),
    dayBucketISO,
  );

  const priceRows = (priceHistoryRaw.data ?? [])
    .map((r) => ({ t: r.observed_at as string, v: Number(r.price) }))
    .filter((r) => Number.isFinite(r.v) && r.v > 0 && r.v < 10_000);
  const medianPriceWeekly = medianSeries(priceRows, weekBucketISO);

  type MaturityRow = {
    price: number | null;
    price_usd_equivalent: number | null;
    maturity: string | null;
  };
  const matAll = (listingsForMaturity.data ?? []) as MaturityRow[];
  const byMaturity = new Map<string, number[]>();
  for (const r of matAll) {
    const p = r.price_usd_equivalent ?? r.price;
    if (!p || p <= 0 || p > 10_000) continue;
    const m = r.maturity ?? "unknown";
    const arr = byMaturity.get(m) ?? [];
    arr.push(p);
    byMaturity.set(m, arr);
  }
  const medianByMaturity: Array<{ maturity: string; median: number; count: number }> = [];
  for (const [m, arr] of byMaturity) {
    arr.sort((a, b) => a - b);
    medianByMaturity.push({
      maturity: m,
      median: arr[Math.floor(arr.length / 2)] ?? 0,
      count: arr.length,
    });
  }
  medianByMaturity.sort((a, b) => b.count - a.count);
  const maxMaturityMedian = medianByMaturity.reduce(
    (a, m) => Math.max(a, m.median),
    1,
  );

  const volumeSeries: Series[] = [
    { name: "New listings", color: chartTheme.series[0]!, points: newListingsDaily },
    { name: "Price drops", color: chartTheme.series[3]!, points: priceDropsDaily },
    { name: "Sold", color: chartTheme.series[2]!, points: soldDaily },
    { name: "Price ticks", color: chartTheme.series[1]!, points: priceTicksDaily },
  ];

  // Detect backfill days on the new-listings stream: a single day
  // that's >3x the median of the other days in the window almost
  // always reflects an initial catalog ingest, not organic activity.
  // Flag it on the chart so the spike isn't read as a market event.
  const volumeEvents: ChartEvent[] = (() => {
    const points = newListingsDaily;
    if (points.length < 4) return [];
    const sortedVals = points.map((p) => p.v).sort((a, b) => a - b);
    const median = sortedVals[Math.floor(sortedVals.length / 2)] ?? 0;
    if (median === 0) return [];
    return points
      .filter((p) => p.v >= median * 3 && p.v >= 50)
      .map((p) => ({
        at: p.t,
        label: `Backfill spike (${p.v} listings)`,
        tone: "warn" as const,
      }));
  })();

  const medianPriceSeries: Series[] = [
    {
      name: "Median price (weekly)",
      color: chartTheme.primary,
      points: medianPriceWeekly,
    },
  ];

  const recentAvgDrop =
    (priceDropsRaw.data ?? [])
      .map((r) => Number(r.pct_change))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b, _, arr) => a + b / arr.length, 0) || 0;
  const countDelta =
    (priorCount14.count ?? 0) === 0
      ? (recentCount14.count ?? 0) > 0
        ? 100
        : 0
      : (((recentCount14.count ?? 0) - (priorCount14.count ?? 0)) /
          (priorCount14.count ?? 1)) *
        100;

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Analysis / Trends"
        title="Market trends"
        description="Longitudinal signal across the crested gecko market. Compare the last 14 days to the 14 days before to see where volume, price, and trait interest are moving."
        right={<DataFreshness updatedAt={Date.now()} window="30 days" />}
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="New listings · 14d"
          value={fmtInt(recentCount14.count ?? 0)}
          delta={{ value: countDelta, label: "vs prev 14d" }}
        />
        <KpiCard
          label="Avg drop size"
          value={fmtPct(recentAvgDrop, 1)}
          tone={recentAvgDrop < 0 ? "warn" : "default"}
          sub="arithmetic mean of pct_change"
        />
        <KpiCard
          label="Median listing"
          value={fmtUsd(
            medianByMaturity.reduce((a, m) => a + m.median, 0) /
              Math.max(1, medianByMaturity.length),
          )}
          sub="averaged across maturities"
          tone="info"
        />
        <KpiCard
          label="Tracked listings"
          value={fmtInt(matAll.length)}
          tone="default"
          sub={`${medianByMaturity.length} maturity cohorts`}
        />
      </section>

      <Panel
        title="Discovery activity"
        subtitle="Daily count across ingest streams over the last 30 days. New listings = unique listings first seen that day; price drops + sold are recorded as the events happen. Large early-period bars are part of the initial catalog backfill, not organic activity."
        right={<span className="font-mono text-[11px]">last 30d</span>}
      >
        <TimeSeriesLine
          series={volumeSeries}
          events={volumeEvents}
          height={280}
        />
      </Panel>

      <Panel
        title="Weekly median price"
        subtitle="Median of observed prices per week from the price_history stream."
        right={<span className="font-mono text-[11px]">USD</span>}
      >
        {medianPriceWeekly.length < 2 ? (
          <p className="text-sm text-ink-400">
            Not enough price observations yet — the scraper hasn&apos;t accumulated
            enough history to plot a meaningful median line. Current snapshot is
            below.
          </p>
        ) : (
          <TimeSeriesLine
            series={medianPriceSeries}
            height={280}
            yFormat={(n) => `$${n.toLocaleString()}`}
          />
        )}
      </Panel>

      <Panel
        title="Median price by maturity"
        subtitle="Cross-section of the live market. Bar length = relative median price; the count tells you how thick the market is in each cohort."
      >
        {medianByMaturity.length === 0 ? (
          <p className="text-sm text-ink-400">No maturity data yet.</p>
        ) : (
          <ul className="space-y-3">
            {medianByMaturity.map((m, i) => {
              const pct = (m.median / maxMaturityMedian) * 100;
              const color =
                chartTheme.series[i % chartTheme.series.length] ??
                chartTheme.primary;
              return (
                <li key={m.maturity}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="text-sm capitalize text-ink-100">
                      {m.maturity}
                    </span>
                    <span className="flex items-baseline gap-3 font-mono text-[11px] tabular-nums">
                      <span className="text-ink-500">
                        {fmtInt(m.count)} listings
                      </span>
                      <span className="font-display text-[16px] tabular-nums text-ink-50">
                        {fmtUsd(m.median)}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${color}55, ${color})`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Suspense fallback={<ProfitabilityTiersSkeleton />}>
        <ProfitabilityTiers windowDays={windowDays} />
      </Suspense>

      <Suspense fallback={<TraitMomentumSkeleton />}>
        <TraitMomentumPanels />
      </Suspense>
    </div>
  );
}
