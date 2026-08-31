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
// therefore computed over rows re-confirmed inside CURRENT_HOURS, and the rows
// we could not re-confirm are carried beside them as their own population.
// The two are never averaged into one median or one count.

import { createClient } from "@/lib/supabase/server";
import { looksLikeGroupLot } from "@/lib/traits";
import { CYCLE_HOURS } from "@/lib/market/feed-verdict";
import {
  isRedundantComboName,
  redundantComboKeys,
} from "@/lib/market/combo-redundancy";
import {
  getListingImageMap,
  getSellerVisualMap,
} from "@/lib/media/market-images";

export type ComboSnapshot = {
  combo_name: string;
  /** Catalogue-wide live flag count over the rollup window. Not "now". */
  live_count: number;
  /** Live ads re-confirmed inside the current ingest cycle. */
  fresh_live_count: number;
  fresh_median_ask: number | null;
  sold_count: number;
  median_ask: number | null;
  median_sold: number | null;
  spread_pct: number | null;
  avg_days_to_sell: number | null;
  confidence_score: number;
};

/**
 * A live ad asking less than the freshly confirmed ads it is comparable to.
 *
 * "Comparable" is doing real work here and is deliberately narrow: same trait
 * pair, same maturity, both sides confirmed in the current ingest cycle, no
 * lots and no auctions on either side. It still does not control for sex,
 * weight, lineage, structure or pet-only grading, so this is an observation
 * about asking prices, not a verdict on value.
 */
export type BelowCompsListing = {
  id: string;
  title: string | null;
  url: string | null;
  price: number;
  /** Age class of the animal, and of every ad in its comparison set. */
  maturity: string | null;
  comp_combo: string | null;
  /** Median ask of the matched (combo, maturity) comparison set. */
  comp_median_ask: number | null;
  /** Ads in that set, so the panel can show what the median rests on. */
  comp_n: number | null;
  /** Distinct sellers in that set. */
  comp_sellers: number | null;
  /** How far under the comparison median this ad sits, in percent. */
  pct_below: number;
  seller_name: string | null;
  seller_id: string | null;
  seller_location: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  /** Canonical catalog photo for this exact listing, when captured. */
  image_url: string | null;
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
  /** Marketplace store profile image, never substituted with an animal. */
  avatar_url: string | null;
  /** A recent animal from this seller, explicitly labelled as stock. */
  recent_listing_image_url: string | null;
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
  /** Re-observation window that qualifies a live row for the current cycle. */
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
  below_comps: BelowCompsListing[];
  top_sellers: SellerCard[];
  regional_max_median: number; // for color scaling in the heatmap
  generated_at: string;
};

const WINDOW_DAYS = 365;
// The scraper is a weekly pulse, so "current" must survive between passes.
// A 48-hour window made the homepage empty from midweek onward even while the
// coverage banner correctly described the latest pass as recent.
const CURRENT_HOURS = CYCLE_HOURS;
// Same sanity band the pricing RPCs apply, so a count taken here describes the
// same rows the median was taken over.
const PRICE_SANITY_MAX = 100_000;
// Live rows carry species after 0042. The pricing RPC reads 'crested' and
// 'unknown' (unknown is overwhelmingly crested that predates the tagging),
// so any count meant to describe that same sample has to match the filter.
const PRICED_SPECIES: string[] = ["crested", "unknown"];
// How far under its comparison median an ad has to sit before the panel says
// anything about it.
const BELOW_COMPS_THRESHOLD = 0.25;
const BELOW_COMPS_LIMIT = 12;
// Depth a comparison set needs before it may price anything. Two listings can
// put a median at $3,075 and turn every ordinary ad into a 90% bargain; the
// seller floor stops one seller's price list from becoming the market it is
// under. Both are enforced inside combo_maturity_baselines so a set that
// cannot price anything is never returned in the first place.
const MIN_COMP_N = 5;
const MIN_COMP_SELLERS = 3;
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

/**
 * Key a comparison set by its combo and age class together. The two are joined
 * with a control character rather than a visible separator because trait names
 * legitimately contain spaces, slashes and hyphens, and a collision here would
 * silently price a baby against a set of adults.
 */
const COMP_KEY_SEP = "\u0000";

function compKey(combo: string, maturity: string): string {
  return `${combo}${COMP_KEY_SEP}${maturity}`;
}

function splitCompKey(key: string): [string, string] {
  const i = key.indexOf(COMP_KEY_SEP);
  return i < 0 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

/** Numerics arrive from PostgREST as strings; counts as numbers. Normalise. */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
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
  const freshSince = new Date(Date.now() - CURRENT_HOURS * HOUR_MS).toISOString();

  const [
    summaryQ,
    freshPricedQ,
    freshSellerQ,
    newestStaleQ,
    comboQ,
    breadthQ,
    freshComboListingsQ,
    sellerQ,
  ] =
    await Promise.all([
      // One server-side pass for the hero. The old path pulled up to 10,000
      // live prices and took the median in JS, which was row-capped (so the
      // median described an arbitrary slice) and blended freshly confirmed
      // ads with ones last seen in June.
      supabase.rpc("market_price_summary", { fresh_hours: CURRENT_HOURS }),
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
        .from("v_combo_breadth")
        .select("combo_id, is_redundant_pair")
        .eq("is_redundant_pair", true)
        .limit(2000),
      supabase
        .from("market_listings")
        .select(
          "price_usd_equivalent, norm_traits, cached_traits, title, is_group_lot, is_auction",
        )
        .eq("current_status", "live")
        .in("species", PRICED_SPECIES)
        .eq("is_group_lot", false)
        .gte("last_seen_at", freshSince)
        .not("price_usd_equivalent", "is", null)
        .gt("price_usd_equivalent", 0)
        .lt("price_usd_equivalent", PRICE_SANITY_MAX)
        .limit(4000),
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
    fresh_hours: CURRENT_HOURS,
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

  const redundantKeys = redundantComboKeys(
    (breadthQ.data ?? []) as Array<{
      combo_id: string;
      is_redundant_pair: boolean | null;
    }>,
  );
  const freshComboRows = (freshComboListingsQ.data ?? []) as Array<{
    price_usd_equivalent: number | null;
    norm_traits: string | null;
    cached_traits: string | null;
    title: string | null;
    is_group_lot: boolean | null;
    is_auction: boolean | null;
  }>;

  const combos: ComboSnapshot[] = (comboQ.data ?? [])
    .map((r: ComboSnapshot) => {
      const tokens = comboNameTokens(r.combo_name);
      const prices: number[] = [];
      for (const row of freshComboRows) {
        if (row.is_auction || row.is_group_lot) continue;
        if (looksLikeGroupLot(row.title)) continue;
        const traits = (row.norm_traits || row.cached_traits || "").toLowerCase();
        if (!traits || !tokens.every((t) => traits.includes(t))) continue;
        const price = num(row.price_usd_equivalent);
        if (price == null || price <= 0) continue;
        prices.push(price);
      }
      return {
        combo_name: r.combo_name,
        live_count: r.live_count ?? 0,
        fresh_live_count: prices.length,
        fresh_median_ask: medianOf(prices),
        sold_count: r.sold_count ?? 0,
        median_ask: r.median_ask != null ? Number(r.median_ask) : null,
        median_sold: r.median_sold != null ? Number(r.median_sold) : null,
        spread_pct: r.spread_pct != null ? Number(r.spread_pct) : null,
        avg_days_to_sell:
          r.avg_days_to_sell != null ? Number(r.avg_days_to_sell) : null,
        confidence_score: r.confidence_score ?? 0,
      };
    })
    .filter((c: ComboSnapshot) => !isRedundantComboName(c.combo_name, redundantKeys));
  const anyFresh = combos.some((c) => c.fresh_live_count > 0);
  combos.sort((a, b) =>
    anyFresh
      ? b.fresh_live_count - a.fresh_live_count ||
        (b.fresh_median_ask ?? 0) - (a.fresh_median_ask ?? 0)
      : b.live_count + b.sold_count - (a.live_count + a.sold_count),
  );
  const hottest_combo = combos[0] ?? null;

  // Ads asking less than their comparables.
  //
  // This panel used to be called Opportunities and it was measuring the wrong
  // thing. The baseline came from v_combo_rollups over 365 days: no freshness
  // filter, group lots left in, auctions left in, and every age class pooled
  // into one median. Checked against production it produced 248 "deals" at an
  // average 50% discount, and the top of that list was not a list of deals at
  // all. Every one of the deepest was a baby or a juvenile measured against a
  // median that included adults. A $60 juvenile against a $350 all-ages median
  // is a young animal priced like a young animal.
  //
  // combo_maturity_baselines (migration 0049) cuts the median per (combo,
  // maturity) over freshly re-confirmed single animals, drops auctions, and
  // returns a cell only when it carries at least MIN_COMP_N asks from
  // MIN_COMP_SELLERS distinct sellers. 34 of 1,938 cells currently qualify.
  // A listing with no qualifying cell for its own age class makes no claim.
  const baselines = new Map<
    string,
    { median: number; n: number; sellers: number }
  >();
  const { data: baselineRows } = await supabase.rpc(
    "combo_maturity_baselines",
    {
      fresh_hours: CYCLE_HOURS,
      window_days: WINDOW_DAYS,
      min_fresh: MIN_COMP_N,
      min_sellers: MIN_COMP_SELLERS,
    },
  );
  for (const r of (baselineRows ?? []) as Array<{
    combo_id: string;
    maturity: string | null;
    n_fresh: number | string | null;
    n_fresh_sellers: number | string | null;
    median_fresh_ask: number | string | null;
  }>) {
    const median = num(r.median_fresh_ask);
    if (median == null || median <= 0 || !r.maturity) continue;
    baselines.set(compKey(r.combo_id, r.maturity), {
      median,
      n: num(r.n_fresh) ?? 0,
      sellers: num(r.n_fresh_sellers) ?? 0,
    });
  }

  let below_comps: BelowCompsListing[] = [];
  if (baselines.size > 0) {
    const compSince = new Date(Date.now() - CYCLE_HOURS * HOUR_MS).toISOString();
    const candidateQ = await supabase
      .from("market_listings")
      .select(
        "id, title, url, price_usd_equivalent, maturity, is_auction, norm_traits, cached_traits, seller_id, seller_name, seller_location, first_seen_at, last_seen_at",
      )
      .eq("current_status", "live")
      .in("species", PRICED_SPECIES)
      // A wholesale lot at $50 against a $500 per-animal median is not a 90%
      // discount, it is a different unit. An auction's price is the current
      // bid, which opens low by design and would otherwise fill this list.
      // Both are excluded from the baseline too, so the two sides match.
      .eq("is_group_lot", false)
      .not("maturity", "is", null)
      .not("price_usd_equivalent", "is", null)
      .gte("price_usd_equivalent", 50)
      .lt("price_usd_equivalent", PRICE_SANITY_MAX)
      .gte("last_seen_at", compSince)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(2000);

    // Pre-tokenise once. A listing usually matches several combos, and which
    // one it is measured against decides the number on the card, so the choice
    // cannot be "whichever came first out of the map" the way it used to be.
    const comps: Array<{
      combo: string;
      maturity: string;
      tokens: string[];
      median: number;
      n: number;
      sellers: number;
    }> = [];
    for (const [key, b] of baselines) {
      const [combo, maturity] = splitCompKey(key);
      comps.push({
        combo,
        maturity,
        tokens: comboNameTokens(combo),
        median: b.median,
        n: b.n,
        sellers: b.sellers,
      });
    }

    for (const row of candidateQ.data ?? []) {
      if (row.is_auction) continue;
      if (looksLikeGroupLot(row.title)) continue;
      const traits = (row.norm_traits || row.cached_traits || "").toLowerCase();
      if (!traits || !row.maturity) continue;

      // Of every comparison set this animal belongs to, take the one with the
      // lowest median. That is the smallest claim the data supports: an ad
      // that clears the threshold against its cheapest comparable set is
      // under all of them, and picking the dearest set instead would let the
      // page manufacture a discount by choosing its own denominator.
      let comp: (typeof comps)[number] | null = null;
      for (const c of comps) {
        if (c.maturity !== row.maturity) continue;
        if (!c.tokens.every((t) => traits.includes(t))) continue;
        if (comp == null || c.median < comp.median) comp = c;
      }
      if (comp == null) continue;

      const below = (comp.median - row.price_usd_equivalent) / comp.median;
      if (below < BELOW_COMPS_THRESHOLD) continue;
      below_comps.push({
        id: row.id,
        title: row.title,
        url: row.url,
        price: row.price_usd_equivalent,
        maturity: row.maturity,
        comp_combo: comp.combo,
        comp_median_ask: comp.median,
        comp_n: comp.n,
        comp_sellers: comp.sellers,
        pct_below: Math.round(below * 1000) / 10,
        seller_name: row.seller_name,
        seller_id: row.seller_id,
        seller_location: row.seller_location,
        first_seen_at: row.first_seen_at,
        last_seen_at: row.last_seen_at,
        image_url: null,
      });
    }
    below_comps.sort((a, b) => b.pct_below - a.pct_below);
    below_comps = below_comps.slice(0, BELOW_COMPS_LIMIT);
  }

  const topSellerRows = (sellerQ.data ?? [])
    .filter((s) => (s.total_listings ?? 0) > 0)
    .slice(0, TOP_SELLER_LIMIT);

  const [belowCompImages, sellerVisuals] = await Promise.all([
    getListingImageMap(
      supabase,
      below_comps.map((row) => row.id),
    ),
    getSellerVisualMap(
      supabase,
      topSellerRows.map((row) => row.seller_id),
      { includeRecentListing: true },
    ),
  ]);

  below_comps = below_comps.map((row) => ({
    ...row,
    image_url: belowCompImages.get(row.id) ?? null,
  }));

  const top_sellers: SellerCard[] = topSellerRows.map((s) => {
    const visual = sellerVisuals.get(s.seller_id);
    return {
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
      avatar_url: visual?.avatarUrl ?? null,
      recent_listing_image_url: visual?.recentListingImageUrl ?? null,
    };
  });

  return {
    totals,
    combos,
    hottest_combo,
    below_comps,
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
 * tokenizer the comparison path uses: every part of the combo name must
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
