import "server-only";

import { unstable_cache } from "next/cache";
import type {
  AtlasSnapshot,
  AtlasSoldPool,
  AtlasSpecimen,
  AtlasTrait,
} from "@/components/design-lab/atlas-types";
import { getListingImageMap } from "@/lib/media/market-images";
import { getSoldPageData } from "@/lib/sold/data";
import { createPublicClient } from "@/lib/supabase/public";

const FRESH_HOURS = 48;
const OBSERVATION_DAYS = 8;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PRICE_MAX = 100_000;

const TRAIT_FAMILIES = [
  { name: "Lilly White", pattern: /\blilly\s+white\b/i },
  { name: "Harlequin", pattern: /\bharlequin\b/i },
  { name: "Axanthic", pattern: /\baxanthic\b/i },
  { name: "Cappuccino", pattern: /\bcappuccino\b/i },
  { name: "Tri-color", pattern: /\btri[- ]?colou?r\b/i },
  { name: "Dalmatian", pattern: /\bdalmatian\b/i },
] as const;

type SummaryRow = {
  fresh_listings: number | string | null;
  fresh_median_ask: number | string | null;
  fresh_p25_ask: number | string | null;
  fresh_p75_ask: number | string | null;
  newest_seen_at: string | null;
};

type FreshListingRow = {
  id: string;
  title: string | null;
  price_usd_equivalent: number | string | null;
  cached_traits: string | null;
  norm_traits: string | null;
};

type PriceObservationRow = {
  listing_id: string;
  observed_at: string;
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
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

function traitText(row: FreshListingRow): string {
  return `${row.cached_traits ?? ""}, ${row.norm_traits ?? ""}`;
}

function traitForRow(row: FreshListingRow): string | null {
  const text = traitText(row);
  return TRAIT_FAMILIES.find((family) => family.pattern.test(text))?.name ?? null;
}

function aggregateTraits(rows: FreshListingRow[]): AtlasTrait[] {
  return TRAIT_FAMILIES.map((family) => {
    const prices: number[] = [];
    for (const row of rows) {
      if (!family.pattern.test(traitText(row))) continue;
      const price = numberOrNull(row.price_usd_equivalent);
      if (price !== null && price > 0 && price < PRICE_MAX) prices.push(price);
    }
    return {
      name: family.name,
      median: median(prices) ?? 0,
      count: prices.length,
    };
  }).filter((trait) => trait.count > 0);
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

async function fetchAtlasSnapshot(): Promise<AtlasSnapshot> {
  const now = new Date();
  const supabase = createPublicClient();
  const freshSince = new Date(now.getTime() - FRESH_HOURS * HOUR_MS).toISOString();
  const observationStart = startOfUtcDay(new Date(now.getTime() - (OBSERVATION_DAYS - 1) * DAY_MS));

  const [summaryResult, freshResult, observationResult, sold] = await Promise.all([
    supabase.rpc("market_price_summary", { fresh_hours: FRESH_HOURS }),
    supabase
      .from("market_listings")
      .select("id, title, price_usd_equivalent, cached_traits, norm_traits")
      .eq("current_status", "live")
      .in("species", ["crested", "unknown"])
      .eq("is_group_lot", false)
      .eq("is_auction", false)
      .gte("last_seen_at", freshSince)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(1000),
    supabase
      .from("price_history")
      .select("listing_id, observed_at")
      .gte("observed_at", observationStart.toISOString())
      .order("observed_at", { ascending: true })
      .limit(5000),
    getSoldPageData(),
  ]);

  const summary = ((summaryResult.data ?? []) as SummaryRow[])[0] ?? null;
  const freshRows = freshResult.error
    ? []
    : ((freshResult.data ?? []) as FreshListingRow[]);
  const observationRows = observationResult.error
    ? []
    : ((observationResult.data ?? []) as PriceObservationRow[]);

  const dailySets = new Map<string, Set<string>>();
  if (!observationResult.error) {
    for (let index = 0; index < OBSERVATION_DAYS; index += 1) {
      const day = new Date(observationStart.getTime() + index * DAY_MS);
      dailySets.set(dateKey(day), new Set());
    }
    for (const row of observationRows) {
      const key = row.observed_at.slice(0, 10);
      dailySets.get(key)?.add(row.listing_id);
    }
  }
  const dailyObservations = [...dailySets.entries()].map(([date, ids]) => ({
    date,
    label: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`)),
    count: ids.size,
  }));

  const imageCandidates = freshRows.slice(0, 240);
  const imageMap = await getListingImageMap(
    supabase,
    imageCandidates.map((row) => row.id),
  );
  const specimens: AtlasSpecimen[] = [];
  const usedImages = new Set<string>();
  for (const row of imageCandidates) {
    const src = imageMap.get(row.id);
    if (!src || usedImages.has(src)) continue;
    usedImages.add(src);
    specimens.push({
      src,
      label: traitForRow(row) ?? row.title?.trim() ?? "Recent listing",
      href: `/listings/${row.id}`,
    });
    if (specimens.length === 4) break;
  }

  const p25 = numberOrNull(summary?.fresh_p25_ask);
  const p75 = numberOrNull(summary?.fresh_p75_ask);
  const newestSeen = summary?.newest_seen_at ?? null;
  const firstDay = dailyObservations[0]?.date ?? dateKey(observationStart);
  const lastDay = dailyObservations.at(-1)?.date ?? dateKey(now);

  return {
    generatedAt: generatedAt(now),
    observedWindow: dateRange(`${firstDay}T00:00:00Z`, `${lastDay}T00:00:00Z`),
    observedWindowDays: OBSERVATION_DAYS,
    recentListings:
      numberOrNull(summary?.fresh_listings) ??
      (freshResult.error ? null : freshRows.length),
    medianAsk: numberOrNull(summary?.fresh_median_ask),
    askingRangeNote:
      p25 !== null && p75 !== null
        ? `middle 50% ${money(p25)}–${money(p75)}`
        : "price interval unavailable",
    latestObservationNote: newestSeen
      ? `newest observation ${shortDate(newestSeen)}`
      : "newest observation unavailable",
    capturedSold: soldPool(sold.captured),
    inferredSold: soldPool(sold.inferred),
    dailyObservations,
    traits: aggregateTraits(freshRows),
    specimens,
  };
}

export const getAtlasSnapshot = unstable_cache(
  fetchAtlasSnapshot,
  ["landing-atlas-v1"],
  { revalidate: 300, tags: ["market-data", "sold-data"] },
);
