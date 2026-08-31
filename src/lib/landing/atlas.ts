import "server-only";

import { unstable_cache } from "next/cache";
import type {
  AtlasListing,
  AtlasMorph,
  AtlasPriceObservation,
  AtlasSnapshot,
  AtlasSoldPool,
  AtlasSpecimen,
} from "@/components/design-lab/atlas-types";
import { lookupMorph } from "@/lib/morphs/glossary";
import { quantile } from "@/lib/market/morph-compare";
import { getListingImageMap } from "@/lib/media/market-images";
import { CYCLE_HOURS } from "@/lib/market/feed-verdict";
import { getSoldPageData } from "@/lib/sold/data";
import { createPublicClient } from "@/lib/supabase/public";

const CURRENT_HOURS = CYCLE_HOURS;
const OBSERVATION_DAYS = 8;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PRICE_MAX = 100_000;
const PAGE_SIZE = 1000;
const ID_CHUNK = 80;

const CANONICAL_OVERRIDES = new Map([
  ["lily white", "Lilly White"],
  ["lilywhite", "Lilly White"],
  ["lillywhite", "Lilly White"],
  ["tricolor", "Tri-color"],
  ["tri color", "Tri-color"],
  ["quadstripe", "Quad-stripe"],
  ["quad stripe", "Quad-stripe"],
  ["whitewall", "White Wall"],
]);

type FreshListingRow = {
  id: string;
  title: string | null;
  price_usd_equivalent: number | string | null;
  cached_traits: string | null;
  norm_traits: string | null;
  seller_id: string | null;
  maturity: string | null;
  sex: string | null;
  first_listed_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type TaxonomyRow = {
  canonical_name: string;
  category: string;
  synonyms: string[] | null;
  is_morph: boolean;
};

type SynonymRow = {
  alias: string;
  canonical: string;
};

type PriceObservationRow = {
  listing_id: string;
  observed_at: string;
  price_usd_equivalent: number | string | null;
  price: number | string | null;
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validPrice(value: unknown): number | null {
  const price = numberOrNull(value);
  return price !== null && price > 0 && price < PRICE_MAX ? price : null;
}

function money(value: number | null): string {
  if (value === null) return "unavailable";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function shortDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function dateRange(oldest: string | null, newest: string | null): string {
  if (!oldest && !newest) return "no dated records";
  if (!oldest || oldest === newest) return shortDate(oldest ?? newest!);
  return `${shortDate(oldest!)}–${shortDate(newest!)}`;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeTrait(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

function rawTraitTokens(row: Pick<FreshListingRow, "cached_traits" | "norm_traits">): string[] {
  const source = row.cached_traits?.trim() || row.norm_traits?.trim() || "";
  if (!source) return [];
  const direct = source
    .split(/[|,]/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !token.includes(":"));
  return direct.length > 1 ? direct : [source.trim()];
}

function buildMorphUniverse(
  taxonomyRows: ReadonlyArray<TaxonomyRow>,
  synonymRows: ReadonlyArray<SynonymRow>,
): { morphs: AtlasMorph[]; aliasToCanonical: Map<string, string> } {
  const taxonomyByName = new Map(
    taxonomyRows
      .filter((row) => row.is_morph !== false)
      .map((row) => [normalizeTrait(row.canonical_name), row]),
  );
  const aliasToCanonical = new Map<string, string>();
  for (const row of taxonomyRows) {
    aliasToCanonical.set(normalizeTrait(row.canonical_name), row.canonical_name);
    for (const alias of row.synonyms ?? []) {
      aliasToCanonical.set(normalizeTrait(alias), row.canonical_name);
    }
  }
  for (const row of synonymRows) {
    const canonicalRow = taxonomyByName.get(normalizeTrait(row.canonical));
    aliasToCanonical.set(normalizeTrait(row.alias), canonicalRow?.canonical_name ?? row.canonical);
  }
  for (const [alias, target] of CANONICAL_OVERRIDES) {
    aliasToCanonical.set(normalizeTrait(alias), target);
  }

  const aliasesByCanonical = new Map<string, Set<string>>();
  for (const [alias, canonical] of aliasToCanonical) {
    const set = aliasesByCanonical.get(canonical) ?? new Set<string>();
    if (normalizeTrait(alias) !== normalizeTrait(canonical)) set.add(alias);
    aliasesByCanonical.set(canonical, set);
  }

  const morphs = taxonomyRows
    .filter((row) => row.is_morph !== false)
    .filter((row) => {
      const override = CANONICAL_OVERRIDES.get(normalizeTrait(row.canonical_name));
      return !override || normalizeTrait(override) === normalizeTrait(row.canonical_name);
    })
    .map((row) => {
      const canonical = aliasToCanonical.get(normalizeTrait(row.canonical_name)) ?? row.canonical_name;
      return {
        name: canonical,
        category: row.category?.trim().toLowerCase() || "other",
        aliases: [...(aliasesByCanonical.get(canonical) ?? [])].sort(),
        description: lookupMorph(canonical)?.description ?? null,
      } satisfies AtlasMorph;
    });

  const deduped = new Map<string, AtlasMorph>();
  for (const morph of morphs) {
    const current = deduped.get(morph.name);
    if (!current) {
      deduped.set(morph.name, morph);
      continue;
    }
    deduped.set(morph.name, {
      ...current,
      aliases: [...new Set([...current.aliases, ...morph.aliases])].sort(),
      description: current.description ?? morph.description,
    });
  }
  return { morphs: [...deduped.values()], aliasToCanonical };
}

function canonicalTraits(row: FreshListingRow, aliasToCanonical: ReadonlyMap<string, string>): string[] {
  const traits = new Set<string>();
  for (const raw of rawTraitTokens(row)) {
    const canonical = aliasToCanonical.get(normalizeTrait(raw));
    if (canonical) traits.add(canonical);
  }
  return [...traits];
}

function soldPool(
  pool: { total: number; oldestSoldAt: string | null; newestSoldAt: string | null } | null,
): AtlasSoldPool {
  return {
    count: pool?.total ?? null,
    window: pool ? dateRange(pool.oldestSoldAt, pool.newestSoldAt) : "unavailable",
  };
}

function generatedAt(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/Denver",
  }).format(value);
}

async function fetchFreshRows(supabase: ReturnType<typeof createPublicClient>, freshSince: string) {
  const rows: FreshListingRow[] = [];
  for (let from = 0; from < 10_000; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("market_listings")
      .select("id, title, price_usd_equivalent, cached_traits, norm_traits, seller_id, maturity, sex, first_listed_at, first_seen_at, last_seen_at")
      .eq("current_status", "live")
      .in("species", ["crested", "unknown"])
      .eq("is_group_lot", false)
      .eq("is_auction", false)
      .gte("last_seen_at", freshSince)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as FreshListingRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchPriceObservations(
  supabase: ReturnType<typeof createPublicClient>,
  listingIds: ReadonlyArray<string>,
  since: string,
): Promise<PriceObservationRow[]> {
  const chunks: string[][] = [];
  for (let start = 0; start < listingIds.length; start += ID_CHUNK) {
    chunks.push(listingIds.slice(start, start + ID_CHUNK));
  }
  const results = await Promise.all(chunks.map(async (ids) => {
    const { data, error } = await supabase
      .from("price_history")
      .select("listing_id, observed_at, price_usd_equivalent, price")
      .in("listing_id", ids)
      .gte("observed_at", since)
      .order("observed_at", { ascending: true })
      .limit(5000);
    if (error) return [];
    return (data ?? []) as PriceObservationRow[];
  }));
  return results.flat();
}

async function fetchAtlasSnapshot(): Promise<AtlasSnapshot> {
  const now = new Date();
  const supabase = createPublicClient();
  const freshSince = new Date(now.getTime() - CURRENT_HOURS * HOUR_MS).toISOString();
  const observationStart = startOfUtcDay(new Date(now.getTime() - (OBSERVATION_DAYS - 1) * DAY_MS));

  const [freshRows, taxonomyResult, synonymsResult, sold] = await Promise.all([
    fetchFreshRows(supabase, freshSince),
    supabase
      .from("crested_morph_taxonomy")
      .select("canonical_name, category, synonyms, is_morph")
      .eq("is_morph", true)
      .order("canonical_name", { ascending: true })
      .limit(1000),
    supabase
      .from("morph_taxonomy_synonyms")
      .select("alias, canonical")
      .order("alias", { ascending: true })
      .limit(1000),
    getSoldPageData(),
  ]);

  const taxonomyRows = taxonomyResult.error ? [] : (taxonomyResult.data ?? []) as TaxonomyRow[];
  const synonymRows = synonymsResult.error ? [] : (synonymsResult.data ?? []) as SynonymRow[];
  const universe = buildMorphUniverse(taxonomyRows, synonymRows);
  const imageMapPromise = getListingImageMap(supabase, freshRows.map((row) => row.id));
  const observationRowsPromise = fetchPriceObservations(
    supabase,
    freshRows.map((row) => row.id),
    observationStart.toISOString(),
  );
  const [imageMap, observationRows] = await Promise.all([imageMapPromise, observationRowsPromise]);

  const listings: AtlasListing[] = freshRows.map((row) => ({
    id: row.id,
    title: row.title?.trim() || "Untitled listing",
    price: validPrice(row.price_usd_equivalent),
    traits: canonicalTraits(row, universe.aliasToCanonical),
    sellerId: row.seller_id,
    maturity: row.maturity,
    sex: row.sex,
    firstListedAt: row.first_listed_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    imageUrl: imageMap.get(row.id) ?? null,
  }));

  const traitCounts = new Map<string, number>();
  for (const listing of listings) {
    for (const trait of listing.traits) {
      traitCounts.set(trait, (traitCounts.get(trait) ?? 0) + 1);
    }
  }
  const morphs = [...universe.morphs].sort((a, b) =>
    (traitCounts.get(b.name) ?? 0) - (traitCounts.get(a.name) ?? 0)
      || a.name.localeCompare(b.name),
  );

  const dedupedObservations = new Map<string, AtlasPriceObservation>();
  for (const row of observationRows) {
    const price = validPrice(row.price_usd_equivalent ?? row.price);
    if (price === null) continue;
    const date = row.observed_at.slice(0, 10);
    dedupedObservations.set(`${row.listing_id}:${date}`, {
      listingId: row.listing_id,
      date,
      price,
    });
  }
  const priceObservations = [...dedupedObservations.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.listingId.localeCompare(b.listingId),
  );

  const dailySets = new Map<string, Set<string>>();
  for (let index = 0; index < OBSERVATION_DAYS; index += 1) {
    const day = new Date(observationStart.getTime() + index * DAY_MS);
    dailySets.set(dateKey(day), new Set());
  }
  for (const row of priceObservations) dailySets.get(row.date)?.add(row.listingId);
  const dailyObservations = [...dailySets.entries()].map(([date, ids]) => ({
    date,
    label: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`)),
    count: ids.size,
  }));

  const specimens: AtlasSpecimen[] = [];
  const usedImages = new Set<string>();
  for (const row of listings) {
    if (!row.imageUrl || usedImages.has(row.imageUrl)) continue;
    usedImages.add(row.imageUrl);
    specimens.push({
      src: row.imageUrl,
      label: row.traits[0] ?? row.title,
      href: `/listings/${row.id}`,
    });
    if (specimens.length === 4) break;
  }

  const currentPrices = listings.map((listing) => listing.price).filter((price): price is number => price !== null);
  const medianAsk = quantile(currentPrices, 0.5);
  const p25 = quantile(currentPrices, 0.25);
  const p75 = quantile(currentPrices, 0.75);
  const newestSeen = listings
    .map((listing) => listing.lastSeenAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const firstDay = dailyObservations[0]?.date ?? dateKey(observationStart);
  const lastDay = dailyObservations.at(-1)?.date ?? dateKey(now);

  return {
    generatedAt: generatedAt(now),
    generatedAtIso: now.toISOString(),
    observedWindow: dateRange(`${firstDay}T00:00:00Z`, `${lastDay}T00:00:00Z`),
    observedWindowDays: OBSERVATION_DAYS,
    currentWindowHours: CURRENT_HOURS,
    recentListings: listings.length,
    medianAsk,
    askingRangeNote: p25 !== null && p75 !== null
      ? `middle 50% ${money(p25)}–${money(p75)}`
      : "price interval unavailable",
    latestObservationNote: newestSeen
      ? `newest observation ${shortDate(newestSeen)}`
      : "newest observation unavailable",
    capturedSold: soldPool(sold.captured),
    inferredSold: soldPool(sold.inferred),
    dailyObservations,
    morphs,
    listings,
    priceObservations,
    traits: morphs.slice(0, 6).map((morph) => {
      const rows = listings.filter((listing) => listing.traits.includes(morph.name));
      const prices = rows.map((listing) => listing.price).filter((price): price is number => price !== null);
      return { name: morph.name, median: quantile(prices, 0.5) ?? 0, count: prices.length };
    }),
    specimens,
  };
}

export const getAtlasSnapshot = unstable_cache(
  fetchAtlasSnapshot,
  ["landing-atlas-v3"],
  { revalidate: 300, tags: ["market-data", "sold-data"] },
);
