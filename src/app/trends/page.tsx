// Market Trends — longitudinal view of the crested gecko market.
//
// Windowing: the crested-gecko market moves slowly (weeks-to-months, not
// days), so this page operates on a 90-day default window with an optional
// 180-day toggle. Inside the window the "trend direction" KPIs compare
// the late half (most recent 45 days) to the early half. No "vs prior
// window" deltas yet — the dataset starts ~90d ago, so a prior window
// would be empty; deltas will switch to true period-over-period once
// the catalog has been running for >180d.
//
// Supply vs demand framing: production is the rate at which new listings
// enter the catalog; demand is the rate at which they leave as sold. The
// ratio (added / max(sold, 1)) is informative as a trend more than as an
// absolute level — the inferred-sold stream is sparse, so the level is
// always high but the *movement* tells us whether the market is
// oversaturating or clearing.
//
// The heavy trait-momentum computation runs in a Suspense-wrapped child.
import { Suspense } from "react";
import { Panel, SectionHeader } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import DataFreshness from "@/components/ui/DataFreshness";
import MiniSparkline from "@/components/charts/MiniSparkline";
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

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const VALID_WINDOWS = [90, 180] as const;
type WindowDays = (typeof VALID_WINDOWS)[number];

function parseWindow(raw: string | string[] | undefined): WindowDays {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return VALID_WINDOWS.includes(n as WindowDays) ? (n as WindowDays) : 90;
}

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

// Build a complete date axis at the bucket grain so consumers (delta math,
// cumulative inventory) see explicit zeros for buckets with no events
// instead of gaps that misread as "no data."
function fillBuckets(
  pts: SeriesPoint[],
  start: Date,
  end: Date,
  bucket: (iso: string) => string | null,
  stepDays: number,
): SeriesPoint[] {
  const byKey = new Map<string, number>();
  for (const p of pts) {
    const k = bucket(p.t.toISOString());
    if (k) byKey.set(k, p.v);
  }
  const out: SeriesPoint[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const k = bucket(cursor.toISOString());
    if (k) out.push({ t: new Date(k + "T00:00:00Z"), v: byKey.get(k) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + stepDays);
  }
  // Dedupe (weekly bucket can map several days to the same monday).
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = p.t.toISOString();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function sumInRange(
  rows: Array<{ t: string }>,
  start: Date,
  end: Date,
): number {
  let n = 0;
  for (const r of rows) {
    const ms = Date.parse(r.t);
    if (Number.isFinite(ms) && ms >= start.getTime() && ms < end.getTime()) n++;
  }
  return n;
}

function pctDelta(early: number, late: number): number | null {
  if (early === 0) return late > 0 ? 100 : null;
  return ((late - early) / early) * 100;
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams?: { window?: string | string[] };
}) {
  const supabase = createClient();
  const windowDays: WindowDays = parseWindow(searchParams?.window);

  const now = Date.now();
  const since = new Date(now - windowDays * DAY_MS);
  const sinceIso = since.toISOString();
  const midpoint = new Date(now - (windowDays / 2) * DAY_MS);
  const endDate = new Date(now);

  const [
    addedRowsRaw,
    soldRowsRaw,
    priceHistoryRaw,
    listingsForMaturity,
  ] = await Promise.all([
    supabase
      .from("market_listings")
      .select("first_seen_at, price_usd_equivalent, price")
      .gte("first_seen_at", sinceIso)
      .limit(30000),
    // listing_status_events covers BOTH confirmed sold (source=scraper)
    // AND extension-inferred sold (source=extension_inferred). Both
    // contribute to the demand signal per the design call.
    supabase
      .from("listing_status_events")
      .select("observed_at, source")
      .eq("status", "sold")
      .gte("observed_at", sinceIso)
      .limit(30000),
    supabase
      .from("price_history")
      .select("observed_at, price")
      .gte("observed_at", sinceIso)
      .limit(30000),
    supabase
      .from("market_listings")
      .select("price, price_usd_equivalent, maturity")
      .limit(30000),
  ]);

  type AddedRow = {
    first_seen_at: string | null;
    price: number | null;
    price_usd_equivalent: number | null;
  };
  type SoldRow = { observed_at: string | null; source: string | null };
  type PriceRow = { observed_at: string | null; price: number | null };

  const addedRows = ((addedRowsRaw.data ?? []) as AddedRow[]).filter(
    (r): r is AddedRow & { first_seen_at: string } => r.first_seen_at != null,
  );
  const soldRows = ((soldRowsRaw.data ?? []) as SoldRow[]).filter(
    (r): r is SoldRow & { observed_at: string } => r.observed_at != null,
  );

  const addedCount = addedRows.length;
  const soldCount = soldRows.length;
  const soldInferredCount = soldRows.filter(
    (r) => r.source === "extension_inferred",
  ).length;
  const soldConfirmedCount = soldCount - soldInferredCount;

  const addedEarly = sumInRange(
    addedRows.map((r) => ({ t: r.first_seen_at })),
    since,
    midpoint,
  );
  const addedLate = addedCount - addedEarly;
  const soldEarly = sumInRange(
    soldRows.map((r) => ({ t: r.observed_at })),
    since,
    midpoint,
  );
  const soldLate = soldCount - soldEarly;

  const addedDelta = pctDelta(addedEarly, addedLate);
  const soldDelta = pctDelta(soldEarly, soldLate);

  // Use the *late-half* ratio as the headline (current state) and the
  // early-vs-late move as the trend. The full-window ratio is biased by
  // the early-period backfill spike (the catalog only goes back ~90d so
  // anything in the first half captures the initial seed).
  const supplyDemandLate = soldLate === 0 ? null : addedLate / soldLate;
  const supplyDemandEarly = soldEarly === 0 ? null : addedEarly / soldEarly;
  const supplyDemandRatio = supplyDemandLate;
  const supplyDemandTrend =
    supplyDemandEarly != null && supplyDemandLate != null
      ? pctDelta(supplyDemandEarly, supplyDemandLate)
      : null;

  // Weekly added/sold series for the production-vs-sales overlay and the
  // cumulative inventory delta. Filled to the full window so gaps render
  // as zeros, not breaks.
  const addedWeeklyRaw = series(
    addedRows.map((r) => ({ t: r.first_seen_at })),
    weekBucketISO,
  );
  const soldWeeklyRaw = series(
    soldRows.map((r) => ({ t: r.observed_at })),
    weekBucketISO,
  );
  const addedWeekly = fillBuckets(addedWeeklyRaw, since, endDate, weekBucketISO, 7);
  const soldWeekly = fillBuckets(soldWeeklyRaw, since, endDate, weekBucketISO, 7);

  // Cumulative inventory delta = running cumsum(added − sold). The slope
  // up = inventory piling up; slope down = market clearing.
  const cumulativeWeekly: SeriesPoint[] = (() => {
    const byT = new Map<string, { added: number; sold: number }>();
    for (const p of addedWeekly) {
      byT.set(p.t.toISOString(), { added: p.v, sold: 0 });
    }
    for (const p of soldWeekly) {
      const key = p.t.toISOString();
      const cur = byT.get(key) ?? { added: 0, sold: 0 };
      cur.sold = p.v;
      byT.set(key, cur);
    }
    const keys = Array.from(byT.keys()).sort();
    let acc = 0;
    return keys.map((k) => {
      const { added, sold } = byT.get(k)!;
      acc += added - sold;
      return { t: new Date(k), v: acc };
    });
  })();

  // Weekly supply/demand ratio for the KPI tile's mini-line.
  const ratioWeekly: number[] = addedWeekly.map((a, i) => {
    const s = soldWeekly[i]?.v ?? 0;
    return s === 0 ? a.v : a.v / s;
  });

  // Median price within the window, with early-half vs late-half delta.
  const priceRows = ((priceHistoryRaw.data ?? []) as PriceRow[])
    .filter((r): r is PriceRow & { observed_at: string; price: number } =>
      r.observed_at != null &&
      r.price != null &&
      Number.isFinite(r.price) &&
      r.price > 0 &&
      r.price < 10_000,
    )
    .map((r) => ({ t: r.observed_at, v: Number(r.price) }));
  const medianPriceWeekly = medianSeries(priceRows, weekBucketISO);

  function medianOf(nums: number[]): number {
    if (nums.length === 0) return 0;
    const sorted = nums.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  }
  const priceEarly = medianOf(
    priceRows
      .filter((r) => Date.parse(r.t) < midpoint.getTime())
      .map((r) => r.v),
  );
  const priceLate = medianOf(
    priceRows
      .filter((r) => Date.parse(r.t) >= midpoint.getTime())
      .map((r) => r.v),
  );
  const medianAll = medianOf(priceRows.map((r) => r.v));
  const priceDelta =
    priceEarly > 0 ? ((priceLate - priceEarly) / priceEarly) * 100 : null;

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

  // Detect backfill days on the added stream: a single bucket >3x the
  // median + ≥50 absolute volume is almost always an initial catalog
  // ingest. Flag so the spike doesn't read as a market event.
  const productionEvents: ChartEvent[] = (() => {
    const points = addedWeekly;
    if (points.length < 4) return [];
    const sortedVals = points.map((p) => p.v).sort((a, b) => a - b);
    const median = sortedVals[Math.floor(sortedVals.length / 2)] ?? 0;
    if (median === 0) return [];
    return points
      .filter((p) => p.v >= median * 3 && p.v >= 50)
      .map((p) => ({
        at: p.t,
        label: `Backfill week (${p.v} listings)`,
        tone: "warn" as const,
      }));
  })();

  const productionVsSales: Series[] = [
    {
      name: "Added (weekly)",
      color: chartTheme.series[0]!,
      points: addedWeekly,
    },
    {
      name: "Sold (weekly)",
      color: chartTheme.series[2]!,
      points: soldWeekly,
    },
  ];

  const cumulativeSeries: Series[] = [
    {
      name: "Cumulative (added − sold)",
      color: chartTheme.primary,
      points: cumulativeWeekly,
    },
  ];

  const medianPriceSeries: Series[] = [
    {
      name: "Median price (weekly)",
      color: chartTheme.primary,
      points: medianPriceWeekly,
    },
  ];

  const otherWindow: WindowDays = windowDays === 90 ? 180 : 90;

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Analysis / Trends"
        title="Market trends"
        description={`Longitudinal signal across the crested gecko market. Window = last ${windowDays} days; "vs prev" deltas compare the late ${windowDays / 2} days to the early ${windowDays / 2} so they're meaningful even before a full prior window has accumulated.`}
        right={
          <div className="flex items-center gap-3">
            <a
              href={`?window=${otherWindow}`}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-300 underline-offset-4 hover:underline"
            >
              Show {otherWindow}d
            </a>
            <DataFreshness updatedAt={Date.now()} window={`${windowDays} days`} />
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={`Listings added · ${windowDays}d`}
          value={fmtInt(addedCount)}
          delta={
            addedDelta != null
              ? { value: addedDelta, label: `vs early ${windowDays / 2}d` }
              : undefined
          }
          sub="Production side"
        />
        <KpiCard
          label={`Listings sold · ${windowDays}d`}
          value={fmtInt(soldCount)}
          delta={
            soldDelta != null
              ? { value: soldDelta, label: `vs early ${windowDays / 2}d` }
              : undefined
          }
          sub={`${fmtInt(soldConfirmedCount)} confirmed · ${fmtInt(soldInferredCount)} inferred`}
          tone="info"
        />
        <div className="relative overflow-hidden rounded-lg border border-ink-700 bg-ink-800 p-4 shadow-panel">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ink-600/50 to-transparent" />
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
              Supply / demand · {windowDays}d
            </div>
            {supplyDemandTrend != null ? (
              <div
                className={`font-mono text-[11px] ${
                  supplyDemandTrend >= 0 ? "text-danger" : "text-ready"
                }`}
              >
                {supplyDemandTrend > 0 ? "+" : ""}
                {supplyDemandTrend.toFixed(1)}%
                <span className="ml-1 text-ink-500">vs early</span>
              </div>
            ) : null}
          </div>
          <div className="mt-1.5 flex items-end justify-between gap-3">
            <div className="text-2xl font-semibold tabular-nums text-ink-50">
              {supplyDemandRatio != null ? (
                <>
                  {supplyDemandRatio.toFixed(1)}
                  <span className="ml-1 text-sm font-normal text-ink-400">: 1</span>
                </>
              ) : (
                <span className="text-ink-500">—</span>
              )}
            </div>
            <MiniSparkline values={ratioWeekly} width={88} height={28} />
          </div>
          <div className="mt-1 text-xs text-ink-400">
            Late {windowDays / 2}d ratio; lower = clearing faster
          </div>
        </div>
        <KpiCard
          label={`Median price · ${windowDays}d`}
          value={fmtUsd(medianAll)}
          delta={
            priceDelta != null
              ? { value: priceDelta, label: `vs early ${windowDays / 2}d` }
              : undefined
          }
          sub={`${fmtInt(priceRows.length)} price ticks`}
          tone="default"
        />
      </section>

      <Panel
        title="Production vs sales"
        subtitle={`Weekly listings added vs weekly sold events over ${windowDays} days. When the added line pulls away from the sold line, supply is accumulating; convergence means the market is clearing. Backfill weeks are annotated to keep them from reading as market events.`}
        right={<span className="font-mono text-[11px]">weekly · {windowDays}d</span>}
      >
        {addedWeekly.length < 2 ? (
          <p className="text-sm text-ink-400">
            Not enough buckets yet to chart.
          </p>
        ) : (
          <TimeSeriesLine
            series={productionVsSales}
            events={productionEvents}
            height={300}
          />
        )}
      </Panel>

      <Panel
        title="Cumulative inventory delta"
        subtitle="Running sum of (added − sold) by week. Slope up = listings piling up faster than they sell; slope down = market clearing. Reads sharply across the whole window because the trend is the integral, not the noise."
        right={<span className="font-mono text-[11px]">weekly · {windowDays}d</span>}
      >
        {cumulativeWeekly.length < 2 ? (
          <p className="text-sm text-ink-400">
            Not enough buckets yet to chart.
          </p>
        ) : (
          <TimeSeriesLine
            series={cumulativeSeries}
            height={240}
          />
        )}
      </Panel>

      <Panel
        title="Weekly median price"
        subtitle={`Median of observed prices per week from the price_history stream over ${windowDays} days.`}
        right={<span className="font-mono text-[11px]">USD</span>}
      >
        {medianPriceWeekly.length < 2 ? (
          <p className="text-sm text-ink-400">
            Not enough price observations yet to plot a meaningful median
            line. Snapshot median for the window: {fmtUsd(medianAll)}.
          </p>
        ) : (
          <TimeSeriesLine
            series={medianPriceSeries}
            height={240}
            yFormat={(n) => `$${n.toLocaleString()}`}
          />
        )}
      </Panel>

      <Panel
        title="Median price by maturity"
        subtitle="Cross-section of the live market. Bar length = relative median price; the count tells you how thick the market is in each cohort. Not window-scoped — reflects the current live catalog."
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

      <Suspense fallback={<TraitMomentumSkeleton />}>
        <TraitMomentumPanels windowDays={windowDays} />
      </Suspense>
    </div>
  );
}
