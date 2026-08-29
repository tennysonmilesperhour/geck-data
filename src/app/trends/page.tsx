// Market Trends: the longitudinal view of the crested gecko market.
//
// Every number on this page now comes from a server-side aggregate
// (trends_weekly_prices, trends_arrivals_weekly, trends_maturity_mix in
// migration 0043). The previous version asked PostgREST for 30,000 rows and
// took medians in JS, but the API caps a response at roughly a thousand rows,
// so the median, the maturity mix and the deltas all described an arbitrary
// slice of the catalog rather than the market. A .limit() cannot fix that;
// the aggregation has to happen in the database.
//
// Windowing: the crested market moves in weeks, not days, so the page runs on
// a 90 day window with a 180 day toggle. Deltas compare the late half of the
// window to the early half, and they are WITHHELD whenever either half has no
// observed days. The feed has a hard 78 day hole (2026-06-10 to 2026-08-26),
// and a delta measured across it describes the scraper calendar, not prices.
//
// The same rule governs the charts: a week nobody observed is null, never
// zero. Zero-filling that hole drew a market crash followed by a bounce, both
// of which were ingest artifacts. The line breaks instead, and the gap is
// labelled where it happened.
//
// The heavy trait-momentum computation still runs in a Suspense-wrapped child.
import { Suspense, type ReactNode } from "react";
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
import { getMarketCoverage } from "@/lib/market/freshness";
import { fmtDate, fmtInt, fmtUsd, newestIso } from "@/lib/format";
import TraitMomentumPanels, {
  TraitMomentumSkeleton,
} from "@/components/trends/TraitMomentumPanels";
import ProfitabilityTiers, {
  ProfitabilityTiersSkeleton,
} from "@/components/trends/ProfitabilityTiers";
import SourceFootnote from "@/components/ui/SourceFootnote";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const VALID_WINDOWS = [90, 180] as const;
type WindowDays = (typeof VALID_WINDOWS)[number];

// The trends_* aggregates cover crested plus not-yet-classified rows, so the
// catalog-wide coverage counts have to describe the same population or the
// chip would compare two different denominators.
const CATALOG_SPECIES: string[] = ["crested", "unknown"];

function parseWindow(raw: string | string[] | undefined): WindowDays {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return VALID_WINDOWS.includes(n as WindowDays) ? (n as WindowDays) : 90;
}

// PostgREST hands bigint and numeric back as either a JSON number or a
// string depending on the column, so every aggregate goes through here.
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function weekStartOf(v: unknown): Date | null {
  if (typeof v !== "string" || v.length < 10) return null;
  const t = Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}

function weekLabel(d: Date): string {
  return fmtDate(d.toISOString());
}

function pctDelta(early: number, late: number): number | null {
  if (early === 0) return null;
  return ((late - early) / early) * 100;
}

type WeeklyPriceRow = {
  week_start: string | null;
  median_price: number | string | null;
  p25_price: number | string | null;
  p75_price: number | string | null;
  n_listings: number | string | null;
  n_observations: number | string | null;
  observed_days: number | string | null;
};

type ArrivalsRow = {
  week_start: string | null;
  arrivals: number | string | null;
  arrivals_dated: number | string | null;
  observed_days: number | string | null;
};

type MaturityRow = {
  maturity: string | null;
  n_listings: number | string | null;
  median_price: number | string | null;
};

type PriceWeek = {
  weekStart: Date;
  median: number | null;
  p25: number | null;
  p75: number | null;
  /** Unique listings priced that week. This is the sample breadth. */
  nListings: number;
  /** Raw price ticks. Collection density, not market breadth. */
  nObservations: number;
  observedDays: number;
};

type ArrivalWeek = {
  weekStart: Date;
  arrivals: number;
  arrivalsDated: number;
  observedDays: number;
};

type ObservedWeek = { weekStart: Date; observedDays: number };
type OutageRun = { firstWeek: Date; lastWeek: Date; weeks: number };

// TimeSeriesLine plots numbers, so a hole cannot be expressed as a null
// inside one series: it has to be a break between series. Splitting on the
// unobserved weeks makes the line stop at the last real observation and
// restart where collection resumed, instead of drawing a straight edge
// across weeks nobody looked at.
function brokenSeries(
  name: string,
  color: string,
  points: ReadonlyArray<{ t: Date; v: number | null }>,
): Series[] {
  const segments: SeriesPoint[][] = [];
  let current: SeriesPoint[] = [];
  for (const p of points) {
    if (p.v == null) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push({ t: p.t, v: p.v });
  }
  if (current.length > 0) segments.push(current);
  return segments.map((pts, i) => ({
    // Numbering the pieces in the legend is the honest label: it says the
    // series is discontinuous rather than implying two different metrics.
    name: segments.length > 1 ? `${name} ${i + 1}/${segments.length}` : name,
    color,
    points: pts,
  }));
}

function outageRuns(weeks: ReadonlyArray<ObservedWeek>): OutageRun[] {
  const runs: OutageRun[] = [];
  let firstWeek: Date | null = null;
  let lastWeek: Date | null = null;
  let count = 0;
  for (const w of weeks) {
    if (w.observedDays === 0) {
      if (!firstWeek) firstWeek = w.weekStart;
      lastWeek = w.weekStart;
      count += 1;
    } else if (firstWeek && lastWeek) {
      runs.push({ firstWeek, lastWeek, weeks: count });
      firstWeek = null;
      lastWeek = null;
      count = 0;
    }
  }
  if (firstWeek && lastWeek) runs.push({ firstWeek, lastWeek, weeks: count });
  return runs;
}

// Markers land on the first and last unobserved week so the reader can see
// where the break sits on the axis. TimeSeriesLine drops events outside the
// plotted domain, so a run that trails the last observation annotates itself
// in the note under the chart instead.
function outageEvents(runs: ReadonlyArray<OutageRun>): ChartEvent[] {
  return runs.flatMap((r) => {
    const marks: ChartEvent[] = [
      {
        at: r.firstWeek,
        label: `No data collected, ${r.weeks} week${r.weeks === 1 ? "" : "s"}`,
        tone: "warn" as const,
      },
    ];
    if (r.lastWeek.getTime() !== r.firstWeek.getTime()) {
      marks.push({
        at: r.lastWeek,
        label: "Collection resumes after this week",
        tone: "warn" as const,
      });
    }
    return marks;
  });
}

function outageSentence(runs: ReadonlyArray<OutageRun>): string {
  return runs
    .map((r) =>
      r.weeks === 1
        ? `the week of ${weekLabel(r.firstWeek)}`
        : `${r.weeks} weeks, from the week of ${weekLabel(r.firstWeek)} through the week of ${weekLabel(r.lastWeek)}`,
    )
    .join("; ");
}

function CoverageChip({
  dot,
  label,
  title,
  detail,
}: {
  dot: "ready" | "busy" | "danger";
  label: string;
  title: string;
  detail: ReactNode;
}) {
  const dotClass =
    dot === "ready" ? "bg-ready" : dot === "busy" ? "bg-busy" : "bg-danger";
  return (
    <span
      className="group relative inline-flex cursor-help items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-300"
      tabIndex={0}
    >
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 hidden w-72 rounded-lg border border-ink-700 bg-ink-900/95 p-3 text-left text-xs normal-case font-normal leading-relaxed tracking-normal text-ink-200 shadow-glow backdrop-blur group-hover:block group-focus-within:block"
      >
        <span className="block font-display text-[13px] font-medium text-ink-50">
          {title}
        </span>
        <span className="mt-1 block text-ink-300">{detail}</span>
      </span>
    </span>
  );
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams?: { window?: string | string[] };
}) {
  const supabase = createClient();
  const windowDays: WindowDays = parseWindow(searchParams?.window);
  const halfDays = windowDays / 2;
  const midpoint = new Date(Date.now() - halfDays * DAY_MS);

  const [pricesRes, arrivalsRes, maturityRes, catalogRes, catalogDatedRes, coverage] =
    await Promise.all([
      supabase.rpc("trends_weekly_prices", { window_days: windowDays }),
      supabase.rpc("trends_arrivals_weekly", { window_days: windowDays }),
      supabase.rpc("trends_maturity_mix", { window_days: windowDays }),
      // Catalog-wide market-date coverage. Head counts, so no row cap applies
      // and the chip can name a denominator larger than one page of rows.
      supabase
        .from("market_listings")
        .select("id", { count: "exact", head: true })
        .in("species", CATALOG_SPECIES),
      supabase
        .from("market_listings")
        .select("id", { count: "exact", head: true })
        .in("species", CATALOG_SPECIES)
        .not("first_listed_at", "is", null),
      // Shared freshness verdict. A throw here would take the page down, and
      // the page is still honest without it, so it degrades to null.
      getMarketCoverage().catch(() => null),
    ]);

  const priceWeeks: PriceWeek[] = [];
  for (const r of (pricesRes.data ?? []) as WeeklyPriceRow[]) {
    const weekStart = weekStartOf(r.week_start);
    if (!weekStart) continue;
    const observedDays = num(r.observed_days) ?? 0;
    const observed = observedDays > 0;
    priceWeeks.push({
      weekStart,
      // An unobserved week has no price, and it must not acquire one on the
      // way to the chart. Null here is what makes the line break later.
      median: observed ? num(r.median_price) : null,
      p25: observed ? num(r.p25_price) : null,
      p75: observed ? num(r.p75_price) : null,
      nListings: observed ? (num(r.n_listings) ?? 0) : 0,
      nObservations: observed ? (num(r.n_observations) ?? 0) : 0,
      observedDays,
    });
  }
  priceWeeks.sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());

  const arrivalWeeks: ArrivalWeek[] = [];
  for (const r of (arrivalsRes.data ?? []) as ArrivalsRow[]) {
    const weekStart = weekStartOf(r.week_start);
    if (!weekStart) continue;
    arrivalWeeks.push({
      weekStart,
      arrivals: num(r.arrivals) ?? 0,
      arrivalsDated: num(r.arrivals_dated) ?? 0,
      observedDays: num(r.observed_days) ?? 0,
    });
  }
  arrivalWeeks.sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());

  const pricesFailed = pricesRes.error != null;
  const arrivalsFailed = arrivalsRes.error != null;
  const maturityFailed = maturityRes.error != null;

  // Coverage of the window itself. Everything that claims to describe the
  // window is qualified by these two numbers.
  const observedArrivalWeeks = arrivalWeeks.filter((w) => w.observedDays > 0);
  const observedWeeks = observedArrivalWeeks.length;
  const totalWeeks = arrivalWeeks.length;
  const observedDaysInWindow = arrivalWeeks.reduce(
    (a, w) => a + w.observedDays,
    0,
  );
  const observedDaysWeekly = arrivalWeeks.map((w) => w.observedDays);

  // Arrivals are only countable for weeks we actually observed. Listings we
  // met later that carry a listing date inside the hole are reported in the
  // outage note rather than charted, because that week was never sampled.
  const arrivalsObserved = observedArrivalWeeks.reduce(
    (a, w) => a + w.arrivals,
    0,
  );
  const arrivalsDatedObserved = observedArrivalWeeks.reduce(
    (a, w) => a + w.arrivalsDated,
    0,
  );
  const arrivalsInsideOutage = arrivalWeeks
    .filter((w) => w.observedDays === 0)
    .reduce((a, w) => a + w.arrivals, 0);

  const earlyArrivalWeeks = arrivalWeeks.filter(
    (w) => w.weekStart.getTime() < midpoint.getTime(),
  );
  const lateArrivalWeeks = arrivalWeeks.filter(
    (w) => w.weekStart.getTime() >= midpoint.getTime(),
  );
  const earlyObservedDays = earlyArrivalWeeks.reduce(
    (a, w) => a + w.observedDays,
    0,
  );
  const lateObservedDays = lateArrivalWeeks.reduce(
    (a, w) => a + w.observedDays,
    0,
  );

  // A half with no observed days cannot be compared to anything. Say which
  // half is missing instead of printing a percentage of nothing.
  const halvesComparable = earlyObservedDays > 0 && lateObservedDays > 0;
  const halfGapReason = !halvesComparable
    ? earlyObservedDays === 0 && lateObservedDays === 0
      ? `No observed days in either half of the last ${windowDays} days.`
      : earlyObservedDays === 0
        ? `No delta: nothing was observed in the early ${halfDays} days.`
        : `No delta: nothing was observed in the late ${halfDays} days.`
    : null;

  const arrivalsEarly = earlyArrivalWeeks
    .filter((w) => w.observedDays > 0)
    .reduce((a, w) => a + w.arrivals, 0);
  const arrivalsLate = lateArrivalWeeks
    .filter((w) => w.observedDays > 0)
    .reduce((a, w) => a + w.arrivals, 0);
  const arrivalsDelta = halvesComparable
    ? pctDelta(arrivalsEarly, arrivalsLate)
    : null;

  // Weekly medians are the only price readings we have, so the price delta
  // compares two named weeks, one per half, and says which weeks they are.
  const pricedWeeks = priceWeeks.filter(
    (w): w is PriceWeek & { median: number } =>
      w.median != null && w.nListings > 0,
  );
  const latestPricedWeek = pricedWeeks.at(-1) ?? null;
  const earlyPriceRef =
    pricedWeeks
      .filter((w) => w.weekStart.getTime() < midpoint.getTime())
      .at(-1) ?? null;
  const latePriceRef =
    pricedWeeks
      .filter((w) => w.weekStart.getTime() >= midpoint.getTime())
      .at(-1) ?? null;
  const priceDelta =
    earlyPriceRef && latePriceRef
      ? pctDelta(earlyPriceRef.median, latePriceRef.median)
      : null;
  const priceDeltaReason =
    priceDelta != null
      ? null
      : !earlyPriceRef && !latePriceRef
        ? "No priced week in this window."
        : !earlyPriceRef
          ? `No priced week in the early ${halfDays} days.`
          : !latePriceRef
            ? `No priced week in the late ${halfDays} days.`
            : "No usable baseline to compare against.";

  const maturityRows = ((maturityRes.data ?? []) as MaturityRow[])
    .map((r) => ({
      maturity: r.maturity ?? "unreported",
      count: num(r.n_listings) ?? 0,
      median: num(r.median_price),
    }))
    .filter((r) => r.count > 0);
  const maturityTotal = maturityRows.reduce((a, r) => a + r.count, 0);
  const maturityReported = maturityRows
    .filter((r) => r.maturity !== "unreported")
    .reduce((a, r) => a + r.count, 0);
  const maturityReportedPct =
    maturityTotal > 0 ? (maturityReported / maturityTotal) * 100 : null;
  const maxMaturityMedian = maturityRows.reduce(
    (a, r) => Math.max(a, r.median ?? 0),
    1,
  );

  const catalogTotal = catalogRes.count ?? null;
  const catalogDated = catalogDatedRes.count ?? null;
  const catalogDatedPct =
    catalogTotal != null && catalogDated != null && catalogTotal > 0
      ? (catalogDated / catalogTotal) * 100
      : null;
  const windowDatedPct =
    arrivalsObserved > 0 ? (arrivalsDatedObserved / arrivalsObserved) * 100 : null;

  // Stamp the header with the newest real observation, not the render time.
  const dataAsOf = newestIso(
    coverage?.newestObservationAt ?? null,
    observedArrivalWeeks.at(-1)?.weekStart.toISOString() ?? null,
    latestPricedWeek?.weekStart.toISOString() ?? null,
  );

  const arrivalOutages = outageRuns(arrivalWeeks);
  const priceOutages = outageRuns(priceWeeks);

  // Backfill detection needs a believable baseline. With three observed weeks
  // in the window a median is meaningless, so the marker only appears once
  // there are at least four weeks to compare against.
  const backfillEvents: ChartEvent[] = (() => {
    if (observedArrivalWeeks.length < 4) return [];
    const sorted = observedArrivalWeeks
      .map((w) => w.arrivals)
      .sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (median === 0) return [];
    return observedArrivalWeeks
      .filter((w) => w.arrivals >= median * 3 && w.arrivals >= 50)
      .map((w) => ({
        at: w.weekStart,
        label: `Backfill week (${w.arrivals} listings)`,
        tone: "warn" as const,
      }));
  })();

  const arrivalsSeries = brokenSeries(
    "Listings added",
    chartTheme.series[0]!,
    arrivalWeeks.map((w) => ({
      t: w.weekStart,
      v: w.observedDays > 0 ? w.arrivals : null,
    })),
  );

  const medianPriceSeries = brokenSeries(
    "Median ask",
    chartTheme.primary,
    priceWeeks.map((w) => ({ t: w.weekStart, v: w.median })),
  );

  // The price panel names its own observed weeks so it stays truthful even
  // if the arrivals aggregate is the one that failed.
  const observedPriceWeeks = priceWeeks.filter((w) => w.observedDays > 0);
  const observedWeekList = observedPriceWeeks.map((w) => weekLabel(w.weekStart));

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Analysis / Trends"
        title="Market trends"
        description={`Longitudinal signal across the crested gecko market, aggregated in the database rather than sampled in the browser. Window is the last ${windowDays} days. Deltas compare the late ${halfDays} days to the early ${halfDays} days, and they are withheld when either half has no observed days, because the feed has gaps that would otherwise read as market moves.`}
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Two separate coverage claims. The first is about how listings
                are dated, the second about how often we looked. The old chip
                merged them and read 100% because every row that passed the
                in-window filter happened to carry a listing date. */}
            <CoverageChip
              dot={
                windowDatedPct == null
                  ? "danger"
                  : windowDatedPct >= 90
                    ? "ready"
                    : windowDatedPct >= 50
                      ? "busy"
                      : "danger"
              }
              label={
                windowDatedPct == null
                  ? "market-date unavailable"
                  : `market-date ${windowDatedPct.toFixed(0)}%`
              }
              title="Market-date coverage"
              detail={
                <>
                  {windowDatedPct == null
                    ? "No observed arrivals in this window, so there is nothing to date."
                    : `${arrivalsDatedObserved.toLocaleString()} of ${arrivalsObserved.toLocaleString()} arrivals in the selected window are dated by MorphMarket's own listing date.`}{" "}
                  {catalogTotal != null && catalogDated != null
                    ? `Across the whole catalog it is ${catalogDated.toLocaleString()} of ${catalogTotal.toLocaleString()} listings (${(catalogDatedPct ?? 0).toFixed(0)}%).`
                    : ""}{" "}
                  Rows without one are bucketed by the day our ingest first saw
                  them, which compresses their history into our scrape calendar.
                </>
              }
            />
            <CoverageChip
              dot={
                observedDaysInWindow === 0
                  ? "danger"
                  : observedWeeks >= totalWeeks * 0.75
                    ? "ready"
                    : observedWeeks >= totalWeeks * 0.4
                      ? "busy"
                      : "danger"
              }
              label={`observed ${observedDaysInWindow}/${windowDays} d`}
              title="Observation coverage"
              detail={
                <>
                  Price observations landed on {observedDaysInWindow} of the last{" "}
                  {windowDays} days, spread over {observedWeeks} of {totalWeeks}{" "}
                  weeks. The ingest is a weekly MorphMarket API pull, so a
                  healthy week contributes one or two observed days, not seven.
                  {coverage?.observedDays30 != null &&
                  coverage?.observedDays90 != null
                    ? ` Catalog wide: ${coverage.observedDays30} observed days in the last 30 and ${coverage.observedDays90} in the last 90.`
                    : ""}
                </>
              }
            />
            <DataFreshness updatedAt={dataAsOf} window={`${windowDays} days`} />
          </div>
        }
      />

      {/* Window toggle: chip group so the 90/180 selection is visually
          obvious instead of buried as a small text link in the header. */}
      <div
        role="group"
        aria-label="Trend window"
        className="inline-flex overflow-hidden rounded-lg border border-ink-700 bg-ink-850 font-mono text-[11px] uppercase tracking-[0.14em]"
      >
        {VALID_WINDOWS.map((w) => {
          const active = w === windowDays;
          return (
            <a
              key={w}
              href={`?window=${w}`}
              aria-current={active ? "page" : undefined}
              className={
                "px-3 py-1.5 transition " +
                (active
                  ? "bg-ready/15 text-ready"
                  : "text-ink-400 hover:bg-ink-800 hover:text-ink-100")
              }
            >
              {w}d
            </a>
          );
        })}
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={`Listings added · ${windowDays}d`}
          value={arrivalsFailed ? "Unavailable" : fmtInt(arrivalsObserved)}
          delta={
            arrivalsDelta != null
              ? { value: arrivalsDelta, label: `vs early ${halfDays}d` }
              : undefined
          }
          sub={
            arrivalsFailed
              ? "Weekly arrivals aggregate did not return."
              : arrivalsDelta != null
                ? `${fmtInt(arrivalsDatedObserved)} dated by MorphMarket, across ${observedWeeks} observed weeks`
                : `${fmtInt(arrivalsDatedObserved)} dated by MorphMarket. ${halfGapReason ?? "No baseline in window."}`
          }
        />
        <KpiCard
          label="Sold flow"
          value={coverage?.newestSoldAt ? "Stale" : "Unavailable"}
          tone="warn"
          sub={
            coverage?.newestSoldAt
              ? `Newest sale of any kind ${fmtDate(coverage.newestSoldAt)}${
                  coverage.soldAgeDays != null
                    ? `, ${Math.round(coverage.soldAgeDays)} days ago`
                    : ""
                }. Not charted below.`
              : "The sold stream could not be read."
          }
        />
        {/* Coverage tile in the old supply/demand slot. Supply over demand
            needs a live sold stream, and there has not been one since June,
            so the honest headline for this window is how often we looked. */}
        <div className="relative overflow-hidden rounded-lg border border-ink-700 bg-ink-800 p-4 shadow-panel">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ink-600/50 to-transparent" />
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
              Observed days · {windowDays}d
            </div>
            {totalWeeks > 0 ? (
              <div className="font-mono text-[11px] text-ink-400">
                {observedWeeks}/{totalWeeks} wk
              </div>
            ) : null}
          </div>
          <div className="mt-1.5 flex items-end justify-between gap-3">
            <div className="text-2xl font-semibold tabular-nums text-ink-50">
              {arrivalsFailed ? (
                <span className="text-ink-500">Unavailable</span>
              ) : (
                <>
                  {observedDaysInWindow}
                  <span className="ml-1 text-sm font-normal text-ink-400">
                    / {windowDays} d
                  </span>
                </>
              )}
            </div>
            <MiniSparkline values={observedDaysWeekly} width={88} height={28} />
          </div>
          <div className="mt-1 text-xs text-ink-400">
            Days carrying a price observation; the pull is weekly, not daily
          </div>
        </div>
        <KpiCard
          label="Median ask · latest observed week"
          value={latestPricedWeek ? fmtUsd(latestPricedWeek.median) : "Unavailable"}
          delta={
            priceDelta != null && latePriceRef && earlyPriceRef
              ? {
                  value: priceDelta,
                  label: `vs week of ${weekLabel(earlyPriceRef.weekStart)}`,
                }
              : undefined
          }
          sub={
            latestPricedWeek
              ? `${fmtInt(latestPricedWeek.nListings)} listings priced, week of ${weekLabel(latestPricedWeek.weekStart)}${
                  priceDeltaReason ? `. ${priceDeltaReason}` : ""
                }`
              : pricesFailed
                ? "Weekly price aggregate did not return."
                : "No priced week in this window."
          }
        />
      </section>

      <Panel
        title="Listings added per week"
        subtitle={`New listings per week over ${windowDays} days, bucketed on MorphMarket's listing date when we have one and on first sight otherwise. Weeks nobody observed are left out of the line instead of being drawn as zero, and backfill weeks are annotated so an ingest does not read as a market event.`}
        right={<span className="font-mono text-[11px]">weekly · {windowDays}d</span>}
      >
        {arrivalsFailed ? (
          <p className="text-sm text-ink-400">
            The weekly arrivals aggregate did not return, so this chart is
            blank rather than approximate.
          </p>
        ) : observedWeeks === 0 ? (
          <p className="text-sm text-ink-400">
            No week in the last {windowDays} days carries an observation, so
            there is nothing to plot.
          </p>
        ) : (
          <TimeSeriesLine
            series={arrivalsSeries}
            events={[...outageEvents(arrivalOutages), ...backfillEvents]}
            height={300}
          />
        )}
        {arrivalOutages.length > 0 ? (
          <p className="mt-3 rounded-md border border-busy/40 bg-busy/[0.06] px-3 py-2 text-xs leading-relaxed text-ink-300">
            <span className="font-mono uppercase tracking-[0.14em] text-busy">
              No data collected
            </span>{" "}
            {outageSentence(arrivalOutages)}. The line breaks there rather than
            plotting zeros, because nothing was measured, and a zero would read
            as a market that stopped.
            {arrivalsInsideOutage > 0
              ? ` ${arrivalsInsideOutage.toLocaleString()} listings we met later carry a listing date inside the gap; they are not charted, since those weeks were never sampled.`
              : ""}
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Sold flow and inventory delta"
        subtitle="A cumulative added minus sold line needs a current sold stream. This one stopped, so the chart is withheld instead of drawn against a flat zero."
        right={<span className="font-mono text-[11px]">withheld</span>}
      >
        <p className="text-sm leading-relaxed text-ink-300">
          {coverage?.newestSoldAt ? (
            <>
              The newest sale of any kind is {fmtDate(coverage.newestSoldAt)}
              {coverage.soldAgeDays != null
                ? `, about ${Math.round(coverage.soldAgeDays)} days ago`
                : ""}
              . The warehouse holds{" "}
              {coverage.capturedSoldEvents != null
                ? `${coverage.capturedSoldEvents.toLocaleString()} captured sold events`
                : "a small pool of captured sold events"}{" "}
              and{" "}
              {coverage.inferredSoldRecords != null
                ? `${coverage.inferredSoldRecords.toLocaleString()} inferred sold records`
                : "a larger pool of inferred sold records"}
              , and the weekly API ingest does not write sold transitions at
              all.
            </>
          ) : (
            <>The sold stream could not be read, so nothing is charted here.</>
          )}{" "}
          Charting weekly sold volume on top of that would show a market that
          stopped clearing. What stopped is the collection of sale events, and
          those are two different claims.
        </p>
      </Panel>

      <Panel
        title="Weekly median ask"
        subtitle={`Median USD equivalent ask per week over ${windowDays} days. One observation per listing per week, so a listing scraped six times counts once, and group lots are excluded. Weeks with no observation break the line.`}
        right={<span className="font-mono text-[11px]">USD</span>}
      >
        {pricesFailed ? (
          <p className="text-sm text-ink-400">
            The weekly price aggregate did not return, so no median is shown.
          </p>
        ) : pricedWeeks.length === 0 ? (
          <p className="text-sm text-ink-400">
            No week in the last {windowDays} days has a priced observation.
          </p>
        ) : (
          <>
            <TimeSeriesLine
              series={medianPriceSeries}
              events={outageEvents(priceOutages)}
              height={240}
              valueFormat="currency"
            />
            {latestPricedWeek ? (
              <p className="mt-3 text-xs leading-relaxed text-ink-400">
                Week of {weekLabel(latestPricedWeek.weekStart)}:{" "}
                {latestPricedWeek.p25 != null && latestPricedWeek.p75 != null ? (
                  <>
                    p25 {fmtUsd(latestPricedWeek.p25)}, median{" "}
                    {fmtUsd(latestPricedWeek.median)}, p75{" "}
                    {fmtUsd(latestPricedWeek.p75)}
                  </>
                ) : (
                  <>median {fmtUsd(latestPricedWeek.median)}</>
                )}{" "}
                across {fmtInt(latestPricedWeek.nListings)} unique listings.
                Sample breadth is that listing count;{" "}
                {fmtInt(latestPricedWeek.nObservations)} raw price ticks landed
                that week, which measures how often we looked rather than how
                wide the market is.
              </p>
            ) : null}
            {observedWeekList.length > 0 ? (
              <p className="mt-1.5 text-xs text-ink-500">
                Observed weeks in window: {observedPriceWeeks.length} of{" "}
                {priceWeeks.length} (
                {observedWeekList.slice(0, 8).join(", ")}
                {observedWeekList.length > 8
                  ? `, and ${observedWeekList.length - 8} more`
                  : ""}
                ).
              </p>
            ) : null}
          </>
        )}
      </Panel>

      <Panel
        title="Median ask by maturity"
        subtitle={`Listings that arrived inside the last ${windowDays} days, group lots and unpriced rows excluded. Bar length is the median relative to the top cohort; the count tells you how thick the market is in each one.`}
      >
        {maturityFailed ? (
          <p className="text-sm text-ink-400">
            The maturity aggregate did not return.
          </p>
        ) : maturityRows.length === 0 ? (
          <p className="text-sm text-ink-400">
            No priced arrivals in the last {windowDays} days.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs leading-relaxed text-ink-400">
              Maturity is optional on MorphMarket.{" "}
              {maturityReportedPct != null
                ? `Only ${maturityReportedPct.toFixed(0)}% of the ${maturityTotal.toLocaleString()} priced arrivals in this window report one`
                : "Most listings do not report one"}
              , so the &quot;unreported&quot; bucket stays visible rather than
              being dropped, which would make the reported cohorts look like
              the whole market.
            </p>
            <ul className="space-y-3">
              {maturityRows.map((m, i) => {
                const pct =
                  m.median != null ? (m.median / maxMaturityMedian) * 100 : 0;
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
                          {m.median != null ? fmtUsd(m.median) : "no median"}
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
          </>
        )}
      </Panel>

      <Suspense fallback={<ProfitabilityTiersSkeleton />}>
        <ProfitabilityTiers windowDays={windowDays} />
      </Suspense>

      <Suspense fallback={<TraitMomentumSkeleton />}>
        <TraitMomentumPanels windowDays={windowDays} />
      </Suspense>

      <SourceFootnote
        sources={[
          "MorphMarket weekly API ingest",
          "trends_weekly_prices, trends_arrivals_weekly, trends_maturity_mix",
        ]}
        n={arrivalsObserved}
        methodologyAnchor="market-index"
      />
    </div>
  );
}
