// Server-side data shaping for the market-intelligence landing page. One
// place to compute the snapshot the home page renders, so the UI components
// stay focused on layout + interaction rather than data wrangling.
//
// Everything here reads through the anon-keyed Supabase client and the
// public-read RLS policies. Numbers are honest: when a derived metric needs
// thicker data than we have (e.g. price trend over weeks), the caller can
// detect the thinness and degrade the widget gracefully.

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
};

export type ComboDaily = {
  /** Combo name (key into ComboSnapshot.combo_name). */
  combo: string;
  /** Appearance count per day across the last 14 days, oldest first. */
  daily: number[];
};

export type MarketSnapshot = {
  totals: {
    listings: number;
    live_listings: number;
    sold_listings: number;
    sellers: number;
    median_price: number | null;
    avg_price: number | null;
    p25_price: number | null;
    p75_price: number | null;
  };
  combos: ComboSnapshot[];
  hottest_combo: ComboSnapshot | null;
  opportunities: OpportunityListing[];
  top_sellers: SellerCard[];
  regional_max_median: number; // for color scaling in the heatmap
  generated_at: string;
};

const WINDOW_DAYS = 365;
const OPPORTUNITY_THRESHOLD = 0.25; // 25% below combo median ask
const OPPORTUNITY_LIMIT = 12;
// Only surface listings the extension has re-observed within this window.
// current_status='live' is sticky: it only flips to 'sold' on an explicit
// sold-badge / auction-close / inferred-sold event, so a listing that's
// been quietly delisted on MorphMarket can linger as "live" for weeks. The
// freshness gate keeps the panel honest — if we haven't seen it lately,
// we can't credibly call it an opportunity.
const OPPORTUNITY_FRESHNESS_DAYS = 7;
const TOP_SELLER_LIMIT = 6;
const COMBO_DAILY_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const supabase = createClient();

  const [listingsCountQ, soldCountQ, sellersCountQ, comboQ, sellerQ, priceQ] = await Promise.all([
    supabase
      .from("market_listings")
      .select("id", { count: "exact", head: true })
      .eq("current_status", "live"),
    supabase
      .from("market_listings")
      .select("id", { count: "exact", head: true })
      .eq("current_status", "sold"),
    supabase
      .from("market_sellers")
      .select("seller_id", { count: "exact", head: true })
      .not("seller_name", "is", null),
    supabase.rpc("v_combo_rollups", { window_days: WINDOW_DAYS }),
    supabase
      .from("market_sellers")
      .select(
        "seller_id, seller_name, seller_location, total_listings, avg_price, median_price, morph_specialization, five_star_rating, membership",
      )
      .not("seller_name", "is", null)
      .order("total_listings", { ascending: false, nullsFirst: false })
      .limit(TOP_SELLER_LIMIT * 2),
    supabase
      .from("market_listings")
      .select("price_usd_equivalent")
      .eq("current_status", "live")
      .not("price_usd_equivalent", "is", null)
      .order("price_usd_equivalent", { ascending: true })
      .limit(10000),
  ]);

  const liveListings = listingsCountQ.count ?? 0;
  const soldListings = soldCountQ.count ?? 0;
  const sellersCount = sellersCountQ.count ?? 0;

  const prices = (priceQ.data ?? [])
    .map((r: { price_usd_equivalent: number | null }) => r.price_usd_equivalent)
    .filter((p): p is number => typeof p === "number" && p > 0 && p < 100000)
    .sort((a, b) => a - b);
  const pct = (p: number): number | null => {
    if (!prices.length) return null;
    const idx = Math.min(prices.length - 1, Math.floor(prices.length * p));
    return prices[idx];
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

  // Opportunities: listings priced more than OPPORTUNITY_THRESHOLD below
  // their combo's median ask. Requires the combo lookup to be populated.
  const comboMedianByName = new Map<string, number>();
  for (const c of combos) {
    if (c.median_ask != null) comboMedianByName.set(c.combo_name, c.median_ask);
  }

  let opportunities: OpportunityListing[] = [];
  if (comboMedianByName.size > 0) {
    const freshSince = new Date(
      Date.now() - OPPORTUNITY_FRESHNESS_DAYS * DAY_MS,
    ).toISOString();
    const oppQ = await supabase
      .from("market_listings")
      .select(
        "id, title, url, price_usd_equivalent, norm_traits, cached_traits, seller_id, seller_name, seller_location, first_seen_at, last_seen_at",
      )
      .eq("current_status", "live")
      .not("price_usd_equivalent", "is", null)
      .gte("price_usd_equivalent", 50)
      .gte("last_seen_at", freshSince)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(2000);

    for (const row of oppQ.data ?? []) {
      const traits = (row.norm_traits || row.cached_traits || "").toLowerCase();
      let matched: { name: string; median: number } | null = null;
      for (const [name, median] of comboMedianByName) {
        const tokens = name.toLowerCase().split(/\s*×\s*|\s*x\s*/);
        if (tokens.every((t) => traits.includes(t))) {
          matched = { name, median };
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
    }));

  return {
    totals: {
      listings: liveListings + soldListings,
      live_listings: liveListings,
      sold_listings: soldListings,
      sellers: sellersCount,
      median_price: pct(0.5),
      avg_price: prices.length
        ? prices.reduce((a, b) => a + b, 0) / prices.length
        : null,
      p25_price: pct(0.25),
      p75_price: pct(0.75),
    },
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
 * For each combo in `combos`, count how many new listings matched it on
 * each of the last COMBO_DAILY_WINDOW_DAYS days. Matching is the same
 * token-prefix logic the opportunities path uses — every part of the
 * combo name (split on × / x) must appear in the listing's
 * norm_traits/cached_traits.
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

  const { data } = await supabase
    .from("market_listings")
    .select("first_seen_at, norm_traits, cached_traits")
    .gte("first_seen_at", since)
    .limit(20000);

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
    tokens: c.combo_name.toLowerCase().split(/\s*×\s*|\s+x\s+/),
  }));

  for (const row of (data ?? []) as Array<{
    first_seen_at: string | null;
    norm_traits: string | null;
    cached_traits: string | null;
  }>) {
    if (!row.first_seen_at) continue;
    const t = Date.parse(row.first_seen_at);
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
