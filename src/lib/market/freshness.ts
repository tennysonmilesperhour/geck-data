import "server-only";

import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";

// One source of truth for "how healthy is the feed right now". The banner,
// the header pip and anything else that wants to make a freshness claim all
// read the same verdict, so the site can never tell a visitor "Ready" in the
// header while /status is reporting a dead pipeline.
//
// The old rule here was max(last_seen_at) < 48h, which answers the wrong
// question twice over. It says "fresh" when a single 565-row batch lands on
// top of 9,274 rows nobody has looked at since June, and it says "stale" from
// midweek onward now that the ingest is a WEEKLY MorphMarket API pull rather
// than a nightly walk. Coverage (what share of the live catalogue was
// actually re-observed) plus the age of the last complete pass answers both.

// The 48h window the market_* RPCs treat as "fresh".
export const FRESH_HOURS = 48;

// One weekly pulse plus a day of slack. Coverage measured over 48h collapses
// to ~0% by Wednesday even when the Monday pass was perfect, so the verdict
// judges the catalogue over a whole cycle and keeps the 48h number for the
// "what landed in the last two days" reading.
export const CYCLE_HOURS = 192;
const CYCLE_DAYS = CYCLE_HOURS / 24;

// Share of the live catalogue that has to be re-observed inside a cycle
// before the feed can claim to describe the market as it stands today.
const COVERAGE_OK_PCT = 80;
const COVERAGE_PARTIAL_PCT = 40;

export type MarketCoverage = {
  totalLive: number | null;
  freshLive: number | null;
  staleLive: number | null;
  /** Share of live listings re-observed inside FRESH_HOURS. */
  coveragePct: number | null;
  /** Share of live listings re-observed inside CYCLE_HOURS. Null if that read failed. */
  cycleCoveragePct: number | null;
  newestObservationAt: string | null;
  observationAgeHours: number | null;
  lastCompletePassAt: string | null;
  observedDays30: number | null;
  observedDays90: number | null;
  newestSoldAt: string | null;
  soldAgeDays: number | null;
  capturedSoldEvents: number | null;
  inferredSoldRecords: number | null;
  freshHours: number;
  cycleHours: number;
};

export type FeedLevel = "ok" | "partial" | "stale" | "unknown";

export type FeedVerdict = {
  level: FeedLevel;
  /** Short enough for the header pip. */
  headline: string;
  /** One or two sentences naming the share, the pass date and the newest sale. */
  detail: string;
};

type CoverageRow = {
  total_live: number | string | null;
  fresh_live: number | string | null;
  stale_live: number | string | null;
  coverage_pct: number | string | null;
  newest_observation_at: string | null;
  observation_age_hours: number | string | null;
  last_complete_pass_at: string | null;
  observed_days_30: number | string | null;
  observed_days_90: number | string | null;
  newest_sold_at: string | null;
  sold_age_days: number | string | null;
  captured_sold_events: number | string | null;
  inferred_sold_records: number | string | null;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// PostgREST hands back a one-row set for a table-returning function.
function firstRow(data: unknown): CoverageRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  return (row as CoverageRow | undefined | null) ?? null;
}

async function fetchMarketCoverage(): Promise<MarketCoverage | null> {
  const supabase = createPublicClient();
  const [freshRes, cycleRes] = await Promise.all([
    supabase.rpc("market_coverage", { fresh_hours: FRESH_HOURS }),
    supabase.rpc("market_coverage", { fresh_hours: CYCLE_HOURS }),
  ]);

  if (freshRes.error) throw freshRes.error;
  const row = firstRow(freshRes.data);
  if (!row) return null;

  // A failed cycle read is left null rather than backfilled from the 48h
  // number: the verdict would rather say "unavailable" than overstate.
  const cycleRow = cycleRes.error ? null : firstRow(cycleRes.data);

  return {
    totalLive: num(row.total_live),
    freshLive: num(row.fresh_live),
    staleLive: num(row.stale_live),
    coveragePct: num(row.coverage_pct),
    cycleCoveragePct: cycleRow ? num(cycleRow.coverage_pct) : null,
    newestObservationAt: iso(row.newest_observation_at),
    observationAgeHours: num(row.observation_age_hours),
    lastCompletePassAt: iso(row.last_complete_pass_at),
    observedDays30: num(row.observed_days_30),
    observedDays90: num(row.observed_days_90),
    newestSoldAt: iso(row.newest_sold_at),
    soldAgeDays: num(row.sold_age_days),
    capturedSoldEvents: num(row.captured_sold_events),
    inferredSoldRecords: num(row.inferred_sold_records),
    freshHours: FRESH_HOURS,
    cycleHours: CYCLE_HOURS,
  };
}

export const getMarketCoverage = unstable_cache(
  fetchMarketCoverage,
  ["market-coverage-v1"],
  { revalidate: 300, tags: ["market-freshness"] },
);

async function fetchLatestMarketSeenAt(): Promise<string | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("market_listings")
    .select("last_seen_at")
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as { last_seen_at: string | null } | null)?.last_seen_at ?? null;
}

// Kept for callers that only need a "newest row" stamp. It is not a health
// signal: one fresh batch pushes it to now while the catalogue rots behind it.
export const getLatestMarketSeenAt = unstable_cache(
  fetchLatestMarketSeenAt,
  ["latest-market-seen-at-v1"],
  { revalidate: 300, tags: ["market-freshness"] },
);

// UTC so the rendered date matches the date the pass is recorded under,
// whichever region the server happens to run in.
function shortDate(isoString: string): string {
  const t = Date.parse(isoString);
  if (Number.isNaN(t)) return "an unknown date";
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysSince(isoString: string | null, now: number): number | null {
  if (!isoString) return null;
  const t = Date.parse(isoString);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now - t) / 86_400_000);
}

function agoLabel(days: number): string {
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  const whole = Math.round(days);
  return whole === 1 ? "1 day ago" : `${whole} days ago`;
}

/**
 * Turns a coverage row into the single verdict every surface renders from.
 * Pure, so the banner and the header pip cannot drift apart. `now` is
 * injectable for tests.
 */
export function marketFeedVerdict(
  coverage: MarketCoverage | null,
  now: number = Date.now(),
): FeedVerdict {
  if (!coverage) {
    return {
      level: "unknown",
      headline: "Coverage unavailable",
      detail: "The coverage check did not return, so we cannot say how much of the catalogue is current.",
    };
  }

  // Prefer the cycle window: it survives the midweek lull in a weekly feed,
  // where the 48h window is empty by design rather than by failure.
  const usingCycle = coverage.cycleCoveragePct !== null;
  const cov = usingCycle ? coverage.cycleCoveragePct : coverage.coveragePct;
  const windowHours = usingCycle ? coverage.cycleHours : coverage.freshHours;
  const windowLabel =
    windowHours >= 48 ? `${Math.round(windowHours / 24)} days` : `${windowHours} hours`;

  const passIso = coverage.lastCompletePassAt ?? coverage.newestObservationAt;
  const passAgeDays = daysSince(passIso, now);

  const coverageClause =
    cov === null || coverage.totalLive === null
      ? "The share of the catalogue that is current is unavailable"
      : `${cov.toFixed(1)}% of ${coverage.totalLive.toLocaleString()} listings still marked live were re-observed in the last ${windowLabel}`;

  const passClause =
    passIso === null || passAgeDays === null
      ? "No catalogue pass is on record"
      : `Last pass ${shortDate(passIso)}, ${agoLabel(passAgeDays)}`;

  const soldAgeDays = coverage.soldAgeDays ?? daysSince(coverage.newestSoldAt, now);
  const soldClause =
    coverage.newestSoldAt === null || soldAgeDays === null
      ? "No sale has been recorded yet"
      : `Newest recorded sale ${shortDate(coverage.newestSoldAt)}, ${agoLabel(soldAgeDays)}`;

  const detail = `${coverageClause}. ${passClause}. ${soldClause}.`;

  if (cov === null && passAgeDays === null) {
    return { level: "unknown", headline: "Coverage unavailable", detail };
  }

  // A pulse that never landed is stale no matter what the last pass covered.
  if (passAgeDays !== null && passAgeDays > CYCLE_DAYS) {
    return { level: "stale", headline: "No recent pass", detail };
  }

  if (cov === null) {
    return { level: "unknown", headline: "Coverage unavailable", detail };
  }

  if (cov >= COVERAGE_OK_PCT) {
    return { level: "ok", headline: "Coverage current", detail };
  }

  if (cov >= COVERAGE_PARTIAL_PCT) {
    return { level: "partial", headline: "Partial coverage", detail };
  }

  return { level: "stale", headline: "Coverage stale", detail };
}

/** Convenience for server components: read the row, return the verdict. */
export async function getMarketFeedVerdict(): Promise<FeedVerdict> {
  try {
    return marketFeedVerdict(await getMarketCoverage());
  } catch {
    return marketFeedVerdict(null);
  }
}
