import "server-only";

import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import {
  CYCLE_HOURS,
  FRESH_HOURS,
  marketFeedVerdict,
  sectionVisibleFromCount,
  type FeedVerdict,
  type MarketCoverage,
} from "./feed-verdict";

// Server-side reads for feed health. The verdict logic itself lives in
// ./feed-verdict so it can be unit tested without Next's server-only shim.
// Re-exported here so existing import sites do not have to change.
export {
  CYCLE_HOURS,
  FRESH_HOURS,
  marketFeedVerdict,
  sectionVisibleFromCount,
} from "./feed-verdict";
export type {
  FeedLevel,
  FeedVerdict,
  MarketCoverage,
} from "./feed-verdict";

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


// ----------------------------------------------------------------------------
// Which optional sections have anything behind them.
// ----------------------------------------------------------------------------
// Two tabs in the header, Shows and Cross-platform, point at tables that hold
// zero rows: show_mentions and cross_platform_listings have never been
// written to. A nav item is a promise that there is something to see, and
// both were breaking it on every page load.
//
// The check is a count rather than a hard-coded removal, so a tab comes back
// the moment its table starts receiving rows and no one has to remember to
// re-add it. Both reads are head-only counts against empty or small tables
// and share the same five minute cache as the freshness read beside them.
export type OptionalSections = {
  shows: boolean;
  crossPlatform: boolean;
  /** Recent price_drops rows. The stream has been dead since June 2026. */
  priceDrops: boolean;
};

const PRICE_DROPS_LIVE_DAYS = 14;

async function fetchOptionalSections(): Promise<OptionalSections> {
  const supabase = createPublicClient();
  const dropsSince = new Date(
    Date.now() - PRICE_DROPS_LIVE_DAYS * 86_400_000,
  ).toISOString();
  const [showsQ, crossQ, dropsQ] = await Promise.all([
    supabase
      .from("show_mentions")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("cross_platform_listings")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("price_drops")
      .select("id", { count: "exact", head: true })
      .gte("observed_at", dropsSince),
  ]);
  return {
    shows: sectionVisibleFromCount(showsQ.count, Boolean(showsQ.error)),
    crossPlatform: sectionVisibleFromCount(crossQ.count, Boolean(crossQ.error)),
    priceDrops: sectionVisibleFromCount(dropsQ.count, Boolean(dropsQ.error)),
  };
}

export const getOptionalSections = unstable_cache(
  fetchOptionalSections,
  ["optional-sections-v2"],
  { revalidate: 300, tags: ["market-freshness"] },
);

/** Convenience for server components: read the row, return the verdict. */
export async function getMarketFeedVerdict(): Promise<FeedVerdict> {
  try {
    return marketFeedVerdict(await getMarketCoverage());
  } catch {
    return marketFeedVerdict(null);
  }
}
