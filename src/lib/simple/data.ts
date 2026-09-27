import "server-only";

// Data access for the site: Price check (home), Morphs, Listings and
// Breeders. Reads geck_data.listings (the catalog the scraper keeps), the
// hourly listing_market_mv (catalog plus where each price sits among
// similar geckos), breeder_market_v, and read-only SQL functions:
//   morph_summary, asking_price_band, sold_price_band, value_grid,
//   growth_curve, trait_upgrades, market_baseline.
//
// Plain rules this file follows so every page tells the same story:
//   - Crested and unclassified rows only.
//   - Prices are USD asking prices. "Sold" means the last asking price we
//     saw before the listing came down, not a negotiated price.
//   - Anything that fails to load returns an empty result instead of
//     throwing, so one bad query never blanks a whole page.

import { createPublicClient } from "@/lib/supabase/public";
import { slugifyTrait } from "@/lib/filters/schema";
import type { SexClass, ValueGrid } from "./estimate";

export type Morph = {
  trait: string;
  slug: string;
  forSale: number;
  askLow: number | null;
  askMid: number | null;
  askHigh: number | null;
  sold: number;
  soldMid: number | null;
  lastSeenAt: string | null;
};

export type PriceBand = {
  n: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  sellers: number;
  newest: string | null;
  oldest: string | null;
};

export type Listing = {
  id: string;
  name: string | null;
  price: number | null;
  currency: string | null;
  sex: string | null;
  maturity: string | null;
  traits: string[];
  image: string | null;
  url: string | null;
  sellerSlug: string | null;
  sellerName: string | null;
  weight: number | null;
  lastSeenAt: string | null;
  soldAt: string | null;
  /** Where the price sits among similar geckos; null when not comparable. */
  position: "low" | "typical" | "high" | null;
  similarLow: number | null;
  similarMid: number | null;
  similarHigh: number | null;
  /** The trait the listing was compared on, or null for all crested geckos. */
  comparedTrait: string | null;
  comparedN: number | null;
  ratio: number | null;
};

export type Breeder = {
  slug: string;
  name: string;
  location: string | null;
  avatarUrl: string | null;
  forSale: number;
  askMid: number | null;
  sold: number;
  topTraits: string[];
  topTraitCounts: number[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** Median of price / similar geckos' middle price across their listings. */
  priceRatio: number | null;
  pricedN: number;
  nLow: number;
  nTypical: number;
  nHigh: number;
  shareHatchling: number | null;
  shareFemale: number | null;
};

// Scraped names sometimes carry HTML entities ("J&amp;J Reptiles").
function decodeEntities(v: string | null | undefined): string | null {
  if (v == null) return null;
  return v
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// A few store names were scraped from the page chrome instead of the store.
const JUNK_NAME = /^(store detail page|morphmarket)$/i;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Sold history starts in May 2026. The old 180-day window would have
// started returning nothing in November, so look back two years and let
// the page print the actual date range instead.
const SOLD_LOOKBACK_DAYS = 730;

// species is unset on the scraper catalog today; treat unset as crested,
// matching the SQL functions (coalesce(species, 'unknown')).
const CRESTED = "species.is.null,species.in.(crested,unknown)";

export async function getMorphs(): Promise<Morph[]> {
  try {
    const { data, error } = await createPublicClient().rpc("morph_summary");
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      trait: String(r.trait),
      slug: slugifyTrait(String(r.trait)),
      forSale: Number(r.for_sale ?? 0),
      askLow: num(r.ask_p25),
      askMid: num(r.ask_p50),
      askHigh: num(r.ask_p75),
      sold: Number(r.sold ?? 0),
      soldMid: num(r.sold_p50),
      lastSeenAt: (r.last_seen_at as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}

/** Resolve URL slugs ("lilly-white") to the trait names stored in the data. */
export function traitsFromSlugs(morphs: Morph[], slugs: string[]): Morph[] {
  const bySlug = new Map(morphs.map((m) => [m.slug, m]));
  const out: Morph[] = [];
  for (const s of slugs) {
    const m = bySlug.get(s);
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

export async function getAskingBand(traits: string[]): Promise<PriceBand | null> {
  try {
    const { data, error } = await createPublicClient().rpc("asking_price_band", {
      p_traits: traits,
    });
    const r = (data as Array<Record<string, unknown>> | null)?.[0];
    if (error || !r || !Number(r.n)) return null;
    return {
      n: Number(r.n),
      p10: num(r.p10),
      p25: num(r.p25),
      p50: num(r.p50),
      p75: num(r.p75),
      p90: num(r.p90),
      sellers: Number(r.n_sellers ?? 0),
      newest: (r.newest_seen_at as string | null) ?? null,
      oldest: null,
    };
  } catch {
    return null;
  }
}

export async function getSoldBand(traits: string[]): Promise<PriceBand | null> {
  try {
    const { data, error } = await createPublicClient().rpc("sold_price_band", {
      p_traits: traits,
      p_lookback_days: SOLD_LOOKBACK_DAYS,
      p_include_inferred: true,
    });
    const r = (data as Array<Record<string, unknown>> | null)?.[0];
    if (error || !r || !Number(r.n)) return null;
    return {
      n: Number(r.n),
      p10: num(r.p10),
      p25: num(r.p25),
      p50: num(r.p50),
      p75: num(r.p75),
      p90: num(r.p90),
      sellers: Number(r.n_sellers ?? 0),
      newest: (r.newest_sold_at as string | null) ?? null,
      oldest: (r.oldest_sold_at as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export type ListingQuery = {
  traits?: string[];
  status?: "for-sale" | "sold";
  sex?: "male" | "female" | null;
  /** hatchling | juvenile | subadult | adult */
  age?: string | null;
  maxPrice?: number | null;
  sort?: "newest" | "price-low" | "price-high" | "value";
  /** Only listings priced in the lowest quarter of similar geckos. */
  lowOnly?: boolean;
  seller?: string | null;
  limit?: number;
  offset?: number;
};

const LISTING_COLUMNS =
  "listing_id, name, price, currency, sex, maturity, trait_array, primary_image_url, listing_url, seller_slug, seller_name, weight_grams, last_seen_at, sold_at, position, similar_p25, similar_p50, similar_p75, compared_trait, compared_n, ratio";

function toListing(r: Record<string, unknown>): Listing {
  return {
    id: String(r.listing_id),
    name: decodeEntities(r.name as string | null),
    price: num(r.price),
    currency: (r.currency as string | null) ?? null,
    sex: (r.sex as string | null) ?? null,
    maturity: (r.maturity as string | null) ?? null,
    traits: ((r.trait_array as string[] | null) ?? []).filter(
      (t) => !/^diet:|^proven breeder/i.test(t),
    ),
    image: (r.primary_image_url as string | null) ?? null,
    url: (r.listing_url as string | null) ?? null,
    sellerSlug: (r.seller_slug as string | null) ?? null,
    sellerName: decodeEntities(r.seller_name as string | null),
    weight: num(r.weight_grams),
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    soldAt: (r.sold_at as string | null) ?? null,
    position: (r.position as Listing["position"]) ?? null,
    similarLow: num(r.similar_p25),
    similarMid: num(r.similar_p50),
    similarHigh: num(r.similar_p75),
    comparedTrait: (r.compared_trait as string | null) ?? null,
    comparedN: num(r.compared_n),
    ratio: num(r.ratio),
  };
}

export async function getListings(
  q: ListingQuery,
): Promise<{ rows: Listing[]; total: number }> {
  try {
    const status = q.status ?? "for-sale";
    // listing_market_mv is the catalog (crested only, sane prices) plus
    // where each price sits among similar geckos. Refreshed hourly.
    let query = createPublicClient()
      .from("listing_market_mv")
      .select(LISTING_COLUMNS, { count: "exact" });
    query =
      status === "sold"
        ? query.not("sold_at", "is", null)
        : query.eq("for_sale", true);
    if (q.traits && q.traits.length) query = query.contains("trait_array", q.traits);
    if (q.sex) query = query.ilike("sex", q.sex);
    if (q.age) {
      const maturity = q.age === "hatchling" ? "Baby" : q.age[0].toUpperCase() + q.age.slice(1);
      query = query.ilike("maturity", maturity);
    }
    if (q.maxPrice) query = query.lte("price", q.maxPrice);
    if (q.seller) query = query.eq("seller_slug", q.seller);
    if (q.lowOnly) query = query.eq("position", "low");

    const sort = q.sort ?? "newest";
    if (sort === "value")
      query = query.order("ratio", { ascending: true, nullsFirst: false });
    else if (sort === "price-low") query = query.order("price", { ascending: true });
    else if (sort === "price-high") query = query.order("price", { ascending: false });
    else if (status === "sold")
      query = query.order("sold_at", { ascending: false, nullsFirst: false });
    else query = query.order("first_seen_at", { ascending: false, nullsFirst: false });

    const limit = q.limit ?? 24;
    const offset = q.offset ?? 0;
    const { data, count, error } = await query.range(offset, offset + limit - 1);
    if (error || !data) return { rows: [], total: 0 };
    return {
      rows: (data as Array<Record<string, unknown>>).map(toListing),
      total: count ?? data.length,
    };
  } catch {
    return { rows: [], total: 0 };
  }
}

/** Asking prices for a trait, for the little distribution chart. */
export async function getAskingPrices(trait: string): Promise<number[]> {
  try {
    const { data, error } = await createPublicClient()
      .from("listings")
      .select("price")
      .or(CRESTED)
      .eq("is_active", true)
      .is("sold_at", null)
      .eq("currency", "USD")
      .gt("price", 0)
      .lt("price", 100000)
      .contains("trait_array", [trait])
      .limit(2000);
    if (error || !data) return [];
    return (data as Array<{ price: number | string }>)
      .map((r) => Number(r.price))
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

export async function getBreeders(): Promise<Breeder[]> {
  try {
    const { data, error } = await createPublicClient()
      .from("breeder_market_v")
      .select("*")
      .order("for_sale", { ascending: false })
      .order("sold", { ascending: false })
      .limit(2000);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => {
      const raw = decodeEntities(r.name as string | null)?.trim();
      return {
        slug: String(r.seller_slug),
        name: raw && !JUNK_NAME.test(raw) ? raw : String(r.seller_slug),
        location: decodeEntities(r.location as string | null),
        avatarUrl: (r.avatar_url as string | null) ?? null,
        forSale: Number(r.for_sale ?? 0),
        askMid: num(r.ask_p50),
        sold: Number(r.sold ?? 0),
        topTraits: (r.top_traits as string[] | null) ?? [],
        topTraitCounts: ((r.top_trait_counts as Array<string | number> | null) ?? []).map(Number),
        firstSeenAt: (r.first_seen_at as string | null) ?? null,
        lastSeenAt: (r.last_seen_at as string | null) ?? null,
        priceRatio: num(r.price_ratio),
        pricedN: Number(r.priced_n ?? 0),
        nLow: Number(r.n_low ?? 0),
        nTypical: Number(r.n_typical ?? 0),
        nHigh: Number(r.n_high ?? 0),
        shareHatchling: num(r.share_hatchling),
        shareFemale: num(r.share_female),
      };
    });
  } catch {
    return [];
  }
}

/** Newest time any listing was checked. The honest "data as of" stamp. */
export async function getDataAsOf(): Promise<string | null> {
  try {
    const { data } = await createPublicClient()
      .from("listings")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    return (data as { last_seen_at: string | null } | null)?.last_seen_at ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Value report: age x sex grid, growth curve, trait upgrades, baseline.
// ---------------------------------------------------------------------


export async function getValueGrid(traits: string[]): Promise<ValueGrid> {
  const grid: ValueGrid = new Map();
  try {
    const { data, error } = await createPublicClient().rpc("value_grid", { p_traits: traits });
    if (error || !data) return grid;
    for (const r of data as Array<Record<string, unknown>>) {
      grid.set(`${r.age_class}|${r.sex_class}`, {
        n: Number(r.n ?? 0),
        p25: num(r.p25),
        p50: num(r.p50),
        p75: num(r.p75),
      });
    }
  } catch {
    /* empty grid renders as "not enough data" */
  }
  return grid;
}

export type GrowthPoint = { bucket: number; label: string; sex: "all" | SexClass; n: number; p50: number | null };

export async function getGrowthCurve(traits: string[]): Promise<GrowthPoint[]> {
  try {
    const { data, error } = await createPublicClient().rpc("growth_curve", { p_traits: traits });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      bucket: Number(r.bucket),
      label: String(r.label),
      sex: String(r.sex_class) as GrowthPoint["sex"],
      n: Number(r.n ?? 0),
      p50: num(r.p50),
    }));
  } catch {
    return [];
  }
}

export type Upgrade = { trait: string; n: number; p50: number; baseN: number; baseP50: number };

export async function getTraitUpgrades(traits: string[]): Promise<Upgrade[]> {
  try {
    const { data, error } = await createPublicClient().rpc("trait_upgrades", { p_traits: traits });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>)
      .map((r) => ({
        trait: String(r.trait),
        n: Number(r.n ?? 0),
        p50: Number(r.p50),
        baseN: Number(r.base_n ?? 0),
        baseP50: Number(r.base_p50),
      }))
      .filter((u) => Number.isFinite(u.p50) && Number.isFinite(u.baseP50) && u.baseP50 > 0);
  } catch {
    return [];
  }
}

export async function getBaseline(): Promise<{ n: number; p50: number | null }> {
  try {
    const { data, error } = await createPublicClient().rpc("market_baseline");
    const r = (data as Array<Record<string, unknown>> | null)?.[0];
    if (error || !r) return { n: 0, p50: null };
    return { n: Number(r.n ?? 0), p50: num(r.p50) };
  } catch {
    return { n: 0, p50: null };
  }
}

export type DataHealth = {
  forSale: number;
  recheckedRecently: number;
  tagged: number;
  withStore: number;
  firstSeen: string | null;
  lastChecked: string | null;
  sold: number;
  soldFrom: string | null;
  soldTo: string | null;
  byWeek: Array<{ week: string; n: number }>;
};

export async function getDataHealth(): Promise<DataHealth | null> {
  try {
    const { data, error } = await createPublicClient().rpc("data_health");
    const r = (data as Array<Record<string, unknown>> | null)?.[0];
    if (error || !r) return null;
    return {
      forSale: Number(r.for_sale ?? 0),
      recheckedRecently: Number(r.rechecked_14d ?? 0),
      tagged: Number(r.tagged ?? 0),
      withStore: Number(r.with_store ?? 0),
      firstSeen: (r.first_seen as string | null) ?? null,
      lastChecked: (r.last_checked as string | null) ?? null,
      sold: Number(r.sold ?? 0),
      soldFrom: (r.sold_from as string | null) ?? null,
      soldTo: (r.sold_to as string | null) ?? null,
      byWeek: ((r.last_seen_by_week as Array<{ week: string; n: number }> | null) ?? []).map((w) => ({
        week: String(w.week),
        n: Number(w.n),
      })),
    };
  } catch {
    return null;
  }
}

export async function getListing(id: string): Promise<(Listing & { ageClass: string | null; sexClass: string | null; basis: string | null }) | null> {
  try {
    const { data, error } = await createPublicClient()
      .from("listing_market_mv")
      .select(`${LISTING_COLUMNS}, age_class, sex_class, basis`)
      .eq("listing_id", id)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as Record<string, unknown>;
    return {
      ...toListing(r),
      ageClass: (r.age_class as string | null) ?? null,
      sexClass: (r.sex_class as string | null) ?? null,
      basis: (r.basis as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Asking prices of the listings a listing was compared with (same group
 * the SQL view used), so the page can place it among them.
 */
export async function getComparablePrices(opts: {
  trait: string | null;
  ageClass: string | null;
  sexClass: string | null;
  basis: string | null;
}): Promise<number[]> {
  try {
    let q = createPublicClient()
      .from("listing_market_mv")
      .select("price")
      .eq("currency", "USD")
      .limit(3000);
    if (opts.trait) q = q.contains("trait_array", [opts.trait]);
    const useAge = opts.basis === "trait_age_sex" || opts.basis === "trait_age" || opts.basis === "market_age_sex";
    const useSex = opts.basis === "trait_age_sex" || opts.basis === "market_age_sex";
    if (useAge && opts.ageClass) q = q.eq("age_class", opts.ageClass);
    if (useSex && opts.sexClass) q = q.eq("sex_class", opts.sexClass);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as Array<{ price: number | string }>).map((r) => Number(r.price)).filter(Number.isFinite);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// History. One row per tracked week. Weeks with no scrape are absent, never
// zero; the page draws them as gaps. `partial` marks a week where only part
// of the catalog was checked, so its middle price rests on a small sample.
// `newListings` and `cameDown` are null when the week before was not a full
// check, because the count would span the gap or the initial backfill.

export type TrendWeek = {
  week: string;
  seen: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  cuts: number;
  raises: number;
  medianCut: number | null;
  newListings: number | null;
  cameDown: number | null;
  afterGap: boolean;
  partial: boolean;
};

export async function getMarketTrend(trait: string | null): Promise<TrendWeek[]> {
  try {
    const { data, error } = await createPublicClient().rpc("market_trend", { p_trait: trait });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      week: String(r.week),
      seen: Number(r.seen ?? 0),
      p25: num(r.p25),
      p50: num(r.p50),
      p75: num(r.p75),
      cuts: Number(r.cuts ?? 0),
      raises: Number(r.raises ?? 0),
      medianCut: num(r.median_cut),
      newListings: r.new_listings == null ? null : Number(r.new_listings),
      cameDown: r.came_down == null ? null : Number(r.came_down),
      afterGap: Boolean(r.after_gap),
      partial: Boolean(r.partial),
    }));
  } catch {
    return [];
  }
}

export type PricePoint = { at: string; price: number; currency: string | null };

/** Every recorded price for one listing, oldest first, with repeats collapsed. */
export async function getListingPriceHistory(id: string): Promise<PricePoint[]> {
  try {
    const { data, error } = await createPublicClient().rpc("listing_price_history", { p_listing_id: id });
    if (error || !data) return [];
    const out: PricePoint[] = [];
    for (const r of data as Array<Record<string, unknown>>) {
      const price = num(r.price);
      if (price == null) continue;
      const currency = r.currency == null ? null : String(r.currency);
      const last = out[out.length - 1];
      if (last && last.price === price && last.currency === currency) continue;
      out.push({ at: String(r.observed_at), price, currency });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The past year, by the month listings were posted. Built from a sample of
// old listing ids (scripts/backfill_history.py), so it includes geckos that
// sold before tracking began. `covered` is false for months the backfill has
// not reached yet; those are drawn as not read, never as zero.

export type MonthRow = {
  month: string;
  sampled: number;
  estPosted: number;
  priced: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  soldShare: number | null;
  goneShare: number | null;
  covered: boolean;
};

export async function getMonthlyHistory(trait: string | null): Promise<MonthRow[]> {
  try {
    const { data, error } = await createPublicClient().rpc("monthly_history", { p_trait: trait });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      month: String(r.month),
      sampled: Number(r.sampled ?? 0),
      estPosted: Number(r.est_posted ?? 0),
      priced: Number(r.priced ?? 0),
      p25: num(r.p25),
      p50: num(r.p50),
      p75: num(r.p75),
      soldShare: num(r.sold_share),
      goneShare: num(r.gone_share),
      covered: Boolean(r.covered),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Markets: asking prices in the US, South Korea, Europe, Canada and the UK,
// converted to USD at the latest stored exchange rate. See
// supabase/migrations/20260927030000_markets.sql for the sources.

export type MarketCode = "US" | "KR" | "EU" | "CA" | "UK" | "US_SHOPS";

export type MarketCell = {
  market: MarketCode;
  trait: string | null;
  n: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  asOf: string | null;
};

export async function getMarketCompare(min = 5): Promise<MarketCell[]> {
  try {
    const { data, error } = await createPublicClient().rpc("market_compare", { p_min: min });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      market: String(r.market) as MarketCode,
      trait: r.trait == null ? null : String(r.trait),
      n: Number(r.n ?? 0),
      p25: num(r.p25),
      p50: num(r.p50),
      p75: num(r.p75),
      asOf: (r.as_of as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}

export type FxRate = { currency: string; perUsd: number; asOf: string; source: string | null };

export async function getFxRates(): Promise<FxRate[]> {
  try {
    const { data, error } = await createPublicClient()
      .from("fx_rates")
      .select("currency, per_usd, as_of, source")
      .order("currency");
    if (error || !data) return [];
    return data.map((r) => ({
      currency: String(r.currency),
      perUsd: Number(r.per_usd),
      asOf: String(r.as_of),
      source: (r.source as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}

export async function getImportMarkup(): Promise<number | null> {
  try {
    const { data, error } = await createPublicClient().rpc("feedle_import_markup");
    if (error) return null;
    return num(data);
  } catch {
    return null;
  }
}

export type MarketWeek = { market: MarketCode; week: string; n: number; p50: number | null };

export async function getMarketWeekly(trait: string | null): Promise<MarketWeek[]> {
  try {
    const { data, error } = await createPublicClient().rpc("market_weekly", { p_trait: trait });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      market: String(r.market) as MarketCode,
      week: String(r.week),
      n: Number(r.n ?? 0),
      p50: num(r.p50),
    }));
  } catch {
    return [];
  }
}

export type TraitWeek = { trait: string; week: string; n: number; p50: number | null; partial: boolean };

/** Weekly middle asking price for up to six morphs, for side-by-side trends. */
export async function getCompareTrends(traits: string[]): Promise<TraitWeek[]> {
  if (!traits.length) return [];
  try {
    const { data, error } = await createPublicClient().rpc("compare_trends", { p_traits: traits.slice(0, 6) });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      trait: String(r.trait),
      week: String(r.week),
      n: Number(r.n ?? 0),
      p50: num(r.p50),
      partial: Boolean(r.partial),
    }));
  } catch {
    return [];
  }
}
