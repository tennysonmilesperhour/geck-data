// Server-side data shaping for the market-intelligence landing page. One
// place to compute the snapshot the home page renders, so the UI components
// stay focused on layout + interaction rather than data wrangling.
//
// Everything here reads through the anon-keyed Supabase client and the
// public-read RLS policies. Numbers are honest: when a derived metric needs
// thicker data than we have (e.g. price trend over weeks), the caller can
// detect the thinness and degrade the widget gracefully.
//
// The load-bearing rule for this page: current_status='live' is a claim about
// the last time we looked, not a claim about today. It only flips to 'sold' on
// an explicit sold event, so an ad that quietly vanished from MorphMarket
// stays "live" in our warehouse indefinitely. Every headline number below is
// therefore computed over rows re-confirmed inside FRESH_HOURS, and the rows
// we could not re-confirm are carried beside them as their own population.
// The two are never averaged into one median or one count.

import { createClient } from "@/lib/supabase/server";

export type ComboSnapshot = {
  combo_name: string;
  live_count: number;
  sold_count: number;
  median_ask: number | null;
  median_sold: number | null;
  spread_pct: number | null;
  avg_days_to_sell: number | null;
  confidence_score: number;
};

export type OpportunityListing = {
  id: string;
  title: string | null;
  url: string | null;
  price: number;
  combo_name: string | null;
  combo_median_ask: number | null;
  /** Live ads the combo median was taken over, so the panel can show its n. */
  combo_n: number | null;
  discount_pct: number; // positive: below combo median
  seller_name: string | null;
  seller_id: string | null;
  seller_location: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

export type SellerCard = {
  seller_id: string;
  seller_name: string | null;
  seller_location: string | null;
  total_listings: number | null;
  avg_price: number | null;
  median_price: number | null;
  morph_specialization: string | null;
  five_star_rating: number | null;
  membership: string | null;
  /**
   * When this seller row was last written. total_listings and the price stats
   * beside it are a stock count frozen at that moment, not a live tally, so
   * the card has to date-stamp them.
   */
  catalogue_updated_at: string | null;
};

export type ComboDaily = {
  /** Combo name (key into ComboSnapshot.combo_name). */
  combo: string;
  /** Appearance count per day across the last 14 days, oldest first. */
  daily: number[];
};

/** One market_listings row as the arrival sparklines read it. */
type ArrivalRow = {
  first_listed_at: string | null;
  first_seen_at: string | null;
  norm_traits: string | null;
  cached_traits: string | null;
};

export type MarketTotals = {
  /** Re-observation window that qualifies a live row as fresh. */
  fresh_hours: number;
  /** Live rows re-confirmed inside that window. This is the headline count. */
  fresh_listings: number;
  /** Live rows we have not re-confirmed since it opened. Context, not stock. */
  stale_listings: number;
  /**
   * Fresh rows carrying a usable single-animal price, i.e. the sample the
   * fresh median and quartiles are actually taken over. Null if the count
   * query failed; the tile then says so instead of implying fresh_listings.
   */
  fresh_priced_listings: number | null;
  fresh_median_ask: number | null;
  fresh_p25_ask: number | null;
  fresh_p75_ask: number | null;
  /** Median of the stale block, reported alongside and never merged in. */
  stale_median_ask: number | null;
  /** Distinct sellers behind the fresh rows. Null when we could not count. */
  fresh_sellers: number | null;
  /** Distinct sellers behind every live row, stale included. */
  live_sellers: number | null;
  /** Newest last_seen_at across live rows: the age of the whole page. */
  newest_seen_at: string | null;
  /** First and last confirmation dates of the stale block. */
  oldest_stale_seen_at: string | null;
  newest_stale_seen_at: string | null;
  /** Multi-animal lots held out of every price figure above. */
  group_lots_excluded: number;
  /**
   * The fresh p75, under its old key. The landing page sizes its price band
   * slider from totals.p75_price, so the name survives the fresh/stale split
   * to keep this module's change self-contained.
   */
  p75_price: number | null;
};

export type MarketSnapshot = {
  totals: MarketTotals;
  combos: ComboSnapshot[];
  hottest_combo: ComboSnapshot | null;
  opportunities: OpportunityListing[];
  top_sellers: SellerCard[];
  regional_max_median: number; // for color scaling in the heatmap
  generated_at: string;
};

const WINDOW_DAYS = 365;
// A listing counts as fresh if we re-confirmed it this recently. Matches the
// default the market_price_summary RPC uses so the copy and the SQL agree.
const FRESH_HOURS = 48;
// Same sanity band the pricing RPCs apply, so a count taken here describes the
// same rows the median was taken over.
const PRICE_SANITY_MAX = 100_000;
// Live rows carry species after 0042. The pricing RPC reads 'crested' and
// 'unknown' (unknown is overwhelmingly crested that predates the tagging),
// so any count meant to describe that same sample has to match the filter.
const PRICED_SPECIES: string[] = ["crested", "unknown"];
const OPPORTUNITY_THRESHOLD = 0.25; // 25% below combo median ask
const OPPORTUNITY_LIMIT = 12;
// Only surface listings the ingest has re-observed within this window.
// current_status='live' is sticky, so without a freshness gate the panel
// advertises ads nobody has confirmed in months.
const OPPORTUNITY_FRESHNESS_DAYS = 7;
// A "discount" is only meaningful against a baseline with some depth. Two
// listings can put a combo median at $3,075 and turn every ordinary ad into a
// 90% bargain, so combos thinner than this do not get to price anything.
const MIN_COMBO_BASELINE_N = 5;
const TOP_SELLER_LIMIT = 6;
const COMBO_DAILY_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
// Cap on the fresh-seller scan. If a future ingest re-confirms more live ads
// than this in one window we would silently undercount, so hitting the cap
// reports null and the tile degrades instead of lying.
const FRESH_SELLER_SCAN_LIMIT = 5000;

// Titles the group-lot backfill would have caught. market_listings.is_group_lot
// was stamped once by migration 0042 and the ingest path does not set it, so
// rows written since then default to false. Re-running the same heuristic here
// keeps a "Wholesale 5/10 Lot Cresties" out of the single-animal comps even
// when the column has not caught up.
const MULTI_ANIMAL_TITLE =
  /\b(lots?|packs?|wholesale|bundle|colony|pairs?|trios?|quad|group)\b|\bx\s*[2-9]\b|\b[2-9]\s*x\b/i;

/**
 * Split a combo display name into the trait phrases that make it up.
 *
 * The separator is either the multiplication sign or a whitespace-delimited
 * "x". The whitespace matters: splitting on a bare /x/ tears "Axanthic" into
 * "a" and "anthic", and every listing containing the letter x then matches
 * the fragment. Both the opportunity matcher and the arrival sparklines call
 * this so the two surfaces cannot drift apart again.
 */
export function comboNameTokens(comboName: string): string[] {
  return comboName
    .toLowerCase()
    .split(/\s*×\s*|\s+x\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Numerics arrive from PostgREST as strings; counts as numbers. Normalise. */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

type PriceSummaryRow = {
  fresh_listings: number | string | null;
  stale_listings: number | string | null;
  fresh_median_ask: number | string | null;
  fresh_p25_ask: number | string | null;
  fresh_p75_ask: number | string | null;
  stale_median_ask: number | string | null;
  newest_seen_at: string | null;
  oldest_stale_seen_at: string | null;
  sellers: number | string | null;
  group_lots_excluded: number | string | null;
};

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const supabase = createClient();

  // The RPC derives its own cutoff from the database clock. This one is for
  // the satellite queries that have to describe the same population; a few
  // seconds of clock skew does not move a 48 hour boundary.
  const freshSince = new Date(Date.now() - FRESH_HOURS * HOUR_MS).toISOString();

  const [summaryQ, freshPricedQ, freshSellerQ, newestStaleQ, comboQ, sellerQ] =
    await Promise.all([
      // One server-side pass for the hero. The old path pulled up to 10,000
      // live prices and took the median in JS, which was row-capped (so the
      // median described an arbitrary slice) and blended freshly confirmed
      // ads with ones last seen in June.
      supabase.rpc("market_price_summary", { fresh_hours: FRESH_HOURS }),
      supabase
        .from("market_listings")
        .select("id", { count: "exact", head: true })
        .eq("current_status", "live")
        .in("species", PRICED_SPECIES)
        .gte("last_seen_at", freshSince)
        .eq("is_group_lot", false)
        .not("price_usd_equivalent", "is", null)
        .gt("price_usd_equivalent", 0)
        .lt("price_usd_equivalent", PRICE_SANITY_MAX),
      supabase
        .from("market_listings")
        .select("seller_id")
        .eq("current_status", "live")
        .gte("last_seen_at", freshSince)
        .not("seller_id", "is", null)
        .limit(FRESH_SELLER_SCAN_LIMIT),
      // Newest confirmation inside the stale block. With the oldest one from
      // the RPC this gives the honest range for "9,274 more, last confirmed
      // May 9 to Jun 9" instead of a bare stale count.
      supabase
        .from("market_listings")
        .select("last_seen_at")
        .eq("current_status", "live")
        .lt("last_seen_at", freshSince)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc("v_combo_rollups", { window_days: WINDOW_DAYS }),
      supabase
        .from("market_sellers")
        .select(
          "seller_id, seller_name, seller_location, total_listings, avg_price, median_price, morph_specialization, five_star_rating, membership, updated_at",
        )
        .not("seller_name", "is", null)
        .order("total_listings", { ascending: false, nullsFirst: false })
        .limit(TOP_SELLER_LIMIT * 2),
    ]);

  const summaryRows = summaryQ.data;
  const summary: PriceSummaryRow | null = Array.isArray(summaryRows)
    ? ((summaryRows[0] as PriceSummaryRow | undefined) ?? null)
    : ((summaryRows as PriceSummaryRow | null) ?? null);

  const freshSellerRows = (freshSellerQ.data ?? []) as Array<{
    seller_id: string | null;
  }>;
  const freshSellers =
    freshSellerQ.error || freshSellerRows.length >= FRESH_SELLER_SCAN_LIMIT
      ? null
      : new Set(freshSellerRows.map((r) => r.seller_id).filter(Boolean)).size;

  const newestStaleSeenAt =
    (newestStaleQ.data as { last_seen_at: string | null } | null)
      ?.last_seen_at ?? null;

  const freshP75 = num(summary?.fresh_p75_ask);

  const totals: MarketTotals = {
    fresh_hours: FRESH_HOURS,
    fresh_listings: num(summary?.fresh_listings) ?? 0,
    stale_listings: num(summary?.stale_listings) ?? 0,
    fresh_priced_listings: freshPricedQ.error ? null : (freshPricedQ.count ?? null),
    fresh_median_ask: num(summary?.fresh_median_ask),
    fresh_p25_ask: num(summary?.fresh_p25_ask),
    fresh_p75_ask: freshP75,
    stale_median_ask: num(summary?.stale_median_ask),
    fresh_sellers: freshSellers,
    live_sellers: num(summary?.sellers),
    newest_seen_at: summary?.newest_seen_at ?? null,
    oldest_stale_seen_at: summary?.oldest_stale_seen_at ?? null,
    newest_stale_seen_at: newestStaleSeenAt,
    group_lots_excluded: num(summary?.group_lots_excluded) ?? 0,
    p75_price: freshP75,
  };

  const combos: ComboSnapshot[] = (comboQ.data ?? []).map((r: ComboSnapshot) => ({
    combo_name: r.combo_name,
    live_count: r.live_count ?? 0,
    sold_count: r.sold_count ?? 0,
    median_ask: r.median_ask != null ? Number(r.median_ask) : null,
    median_sold: r.median_sold != null ? Number(r.median_sold) : null,
    spread_pct: r.spread_pct != null ? Number(r.spread_pct) : null,
    avg_days_to_sell:
      r.avg_days_to_sell != null ? Number(r.avg_days_to_sell) : null,
    confidence_score: r.confidence_score ?? 0,
  }));
  combos.sort(
    (a, b) =>
      b.live_count + b.sold_count - (a.live_count + a.sold_count),
  );
  const hottest_combo = combos[0] ?? null;

  // Opportunities: single animals priced more than OPPORTUNITY_THRESHOLD below
  // their combo's median ask. Requires the combo lookup to be populated.
  const comboBaseline = new Map<string, { median: number; n: number }>();
  for (const c of combos) {
    if (c.median_ask != null && c.live_count >= MIN_COMBO_BASELINE_N) {
      comboBaseline.set(c.combo_name, { median: c.median_ask, n: c.live_count });
    }
  }

  let opportunities: OpportunityListing[] = [];
  if (comboBaseline.size > 0) {
    const oppFreshSince = new Date(
      Date.now() - OPPORTUNITY_FRESHNESS_DAYS * DAY_MS,
    ).toISOString();
    const oppQ = await supabase
      .from("market_listings")
      .select(
        "id, title, url, price_usd_equivalent, norm_traits, cached_traits, seller_id, seller_name, seller_location, first_seen_at, last_seen_at",
      )
      .eq("current_status", "live")
      // A wholesale lot at $50 against a $500 per-animal median is not a 90%
      // discount, it is a different unit. Lots stay out of the comparison.
      .eq("is_group_lot", false)
      .not("price_usd_equivalent", "is", null)
      .gte("price_usd_equivalent", 50)
      .lt("price_usd_equivalent", PRICE_SANITY_MAX)
      .gte("last_seen_at", oppFreshSince)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(2000);

    const comboTokens: Array<{
      name: string;
      tokens: string[];
      median: number;
      n: number;
    }> = [];
    for (const [name, baseline] of comboBaseline) {
      comboTokens.push({
        name,
        tokens: comboNameTokens(name),
        median: baseline.median,
        n: baseline.n,
      });
    }

    for (const row of oppQ.data ?? []) {
      if (MULTI_ANIMAL_TITLE.test(row.title ?? "")) continue;
      const traits = (row.norm_traits || row.cached_traits || "").toLowerCase();
      if (!traits) continue;
      let matched: { name: string; median: number; n: number } | null = null;
      for (const ct of comboTokens) {
        if (ct.tokens.every((t) => traits.includes(t))) {
          matched = { name: ct.name, median: ct.median, n: ct.n };
          break;
        }
      }
      if (!matched) continue;
      const discount = (matched.median - row.price_usd_equivalent) / matched.median;
      if (discount < OPPORTUNITY_THRESHOLD) continue;
      opportunities.push({
        id: row.id,
        title: row.title,
        url: row.url,
        price: row.price_usd_equivalent,
        combo_name: matched.name,
        combo_median_ask: matched.median,
        combo_n: matched.n,
        discount_pct: Math.round(discount * 1000) / 10,
        seller_name: row.seller_name,
        seller_id: row.seller_id,
        seller_location: row.seller_location,
        first_seen_at: row.first_seen_at,
        last_seen_at: row.last_seen_at,
      });
    }
    opportunities.sort((a, b) => b.discount_pct - a.discount_pct);
    opportunities = opportunities.slice(0, OPPORTUNITY_LIMIT);
  }

  const top_sellers: SellerCard[] = (sellerQ.data ?? [])
    .filter((s) => (s.total_listings ?? 0) > 0)
    .slice(0, TOP_SELLER_LIMIT)
    .map((s) => ({
      seller_id: s.seller_id,
      seller_name: s.seller_name,
      seller_location: s.seller_location,
      total_listings: s.total_listings,
      avg_price: s.avg_price != null ? Number(s.avg_price) : null,
      median_price: s.median_price != null ? Number(s.median_price) : null,
      morph_specialization: s.morph_specialization,
      five_star_rating:
        s.five_star_rating != null ? Number(s.five_star_rating) : null,
      membership: s.membership,
      catalogue_updated_at: s.updated_at ?? null,
    }));

  return {
    totals,
    combos,
    hottest_combo,
    opportunities,
    top_sellers,
    regional_max_median: Math.max(
      ...combos.map((c) => c.median_ask ?? 0),
      0,
    ),
    generated_at: new Date().toISOString(),
  };
}

/**
 * For each combo in `combos`, count how many listings arrived on each of the
 * last COMBO_DAILY_WINDOW_DAYS days. Matching uses comboNameTokens, the same
 * tokenizer the opportunities path uses: every part of the combo name must
 * appear in the listing's norm_traits/cached_traits.
 *
 * Arrivals are dated by first_listed_at, the date MorphMarket says the animal
 * went up, falling back to first_seen_at only where the source gave us no
 * list date. Bucketing everything on first_seen_at dated a listing by when
 * our ingest happened to run, which under a weekly feed collapsed a whole
 * week of arrivals into a single Monday spike.
 *
 * Returns a Map keyed by combo_name so the caller can drop a sparkline
 * next to each combo without touching the rest of the snapshot.
 */
export async function getComboDailyAppearances(
  combos: ReadonlyArray<ComboSnapshot>,
): Promise<Map<string, number[]>> {
  if (combos.length === 0) return new Map();
  const supabase = createClient();
  const sinceMs = Date.now() - COMBO_DAILY_WINDOW_DAYS * DAY_MS;
  const since = new Date(sinceMs).toISOString();

  // PostgREST cannot filter on coalesce(), so the two halves of the fallback
  // are fetched separately. They are disjoint by construction (one requires a
  // list date, the other requires its absence), so the union needs no dedupe.
  const [datedQ, undatedQ] = await Promise.all([
    supabase
      .from("market_listings")
      .select("first_listed_at, first_seen_at, norm_traits, cached_traits")
      .gte("first_listed_at", since)
      .limit(20000),
    supabase
      .from("market_listings")
      .select("first_listed_at, first_seen_at, norm_traits, cached_traits")
      .is("first_listed_at", null)
      .gte("first_seen_at", since)
      .limit(20000),
  ]);

  const result = new Map<string, number[]>();
  for (const c of combos) {
    result.set(
      c.combo_name,
      Array.from({ length: COMBO_DAILY_WINDOW_DAYS }, () => 0),
    );
  }

  // Pre-tokenise each combo name once.
  const comboTokens: Array<{ name: string; tokens: string[] }> = combos.map((c) => ({
    name: c.combo_name,
    tokens: comboNameTokens(c.combo_name),
  }));

  const rows = [
    ...((datedQ.data ?? []) as ArrivalRow[]),
    ...((undatedQ.data ?? []) as ArrivalRow[]),
  ];

  for (const row of rows) {
    const listedAt = row.first_listed_at ?? row.first_seen_at;
    if (!listedAt) continue;
    const t = Date.parse(listedAt);
    if (!Number.isFinite(t)) continue;
    const idx = Math.floor((t - sinceMs) / DAY_MS);
    if (idx < 0 || idx >= COMBO_DAILY_WINDOW_DAYS) continue;
    const traits = (row.norm_traits || row.cached_traits || "").toLowerCase();
    if (!traits) continue;
    for (const ct of comboTokens) {
      if (ct.tokens.every((tok) => traits.includes(tok))) {
        const arr = result.get(ct.name)!;
        arr[idx]! += 1;
      }
    }
  }

  return result;
}
