import "server-only";

// Data access for the simplified site: Price check (home), Morphs,
// Listings and Breeders. Everything reads geck_data.listings (the catalog
// the scraper keeps) plus four read-only SQL functions:
//   morph_summary, asking_price_band, sold_price_band, breeder_summary.
//
// Plain rules this file follows so every page tells the same story:
//   - Crested and unclassified rows only.
//   - Prices are USD asking prices. "Sold" means the last asking price we
//     saw before the listing came down, not a negotiated price.
//   - Anything that fails to load returns an empty result instead of
//     throwing, so one bad query never blanks a whole page.

import { createPublicClient } from "@/lib/supabase/public";
import { slugifyTrait } from "@/lib/filters/schema";

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
  lastSeenAt: string | null;
  soldAt: string | null;
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
  lastSeenAt: string | null;
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
  maxPrice?: number | null;
  sort?: "newest" | "price-low" | "price-high";
  seller?: string | null;
  limit?: number;
  offset?: number;
};

const LISTING_COLUMNS =
  "listing_id, name, price, currency, sex, maturity, trait_array, primary_image_url, listing_url, seller_slug, seller_name, last_seen_at, sold_at";

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
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    soldAt: (r.sold_at as string | null) ?? null,
  };
}

export async function getListings(
  q: ListingQuery,
): Promise<{ rows: Listing[]; total: number }> {
  try {
    const status = q.status ?? "for-sale";
    let query = createPublicClient()
      .from("listings")
      .select(LISTING_COLUMNS, { count: "exact" })
      .or(CRESTED)
      .gt("price", 0)
      .lt("price", 100000);
    query =
      status === "sold"
        ? query.not("sold_at", "is", null)
        : query.eq("is_active", true).is("sold_at", null);
    if (q.traits && q.traits.length) query = query.contains("trait_array", q.traits);
    if (q.sex) query = query.ilike("sex", q.sex);
    if (q.maxPrice) query = query.lte("price", q.maxPrice);
    if (q.seller) query = query.eq("seller_slug", q.seller);

    const sort = q.sort ?? "newest";
    if (sort === "price-low") query = query.order("price", { ascending: true });
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

/** Which other morphs show up alongside this one, most common first. */
export async function getPairings(
  trait: string,
  realTraits: Set<string>,
): Promise<Array<{ trait: string; count: number }>> {
  try {
    const { data, error } = await createPublicClient()
      .from("listings")
      .select("trait_array")
      .or(CRESTED)
      .contains("trait_array", [trait])
      .limit(2000);
    if (error || !data) return [];
    const counts = new Map<string, number>();
    for (const r of data as Array<{ trait_array: string[] | null }>) {
      for (const t of r.trait_array ?? []) {
        if (t === trait || !realTraits.has(t)) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts]
      .map(([t, count]) => ({ trait: t, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
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
    const { data, error } = await createPublicClient().rpc("breeder_summary");
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
      lastSeenAt: (r.last_seen_at as string | null) ?? null,
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
