// Trait-premium computation, lifted out of /compare so other surfaces
// can show the same numbers. Given listings + a market baseline,
// returns each trait's median price, sample count, and percent
// premium vs. the baseline.
//
// Not a perfect control (traits co-occur, so a "Pinstripe premium"
// includes the average effect of every other trait that tends to
// appear alongside Pinstripe) — but a fast directional signal that
// answers "what does adding this trait do to price?"

import type { GlossaryEntry } from "@/lib/morphs/glossary";
import { lookupMorph } from "@/lib/morphs/glossary";

export type TraitPremium = {
  trait: string;
  /** Canonical display name from the glossary, when known. */
  displayName: string;
  /** Optional one-sentence description from the glossary. */
  description: string | null;
  count: number;
  median: number;
  /** Percent vs. market baseline. Positive = premium, negative = discount. */
  premium: number;
};

export type ListingForPremium = {
  norm_traits?: string | null;
  cached_traits?: string | null;
  price?: number | null;
  price_usd_equivalent?: number | null;
};

function priceOf(l: ListingForPremium): number | null {
  const p = l.price_usd_equivalent ?? l.price ?? null;
  return p != null && p > 0 && p < 10_000 ? p : null;
}

function traitSet(l: ListingForPremium): Set<string> {
  const raw = (l.norm_traits || l.cached_traits || "").toLowerCase();
  if (!raw) return new Set();
  const tokens = raw.includes(",")
    ? raw.split(",").map((t) => t.trim())
    : raw.split(/\s+/).map((t) => t.trim());
  return new Set(tokens.filter((t) => t && t.length >= 3));
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function computeMarketMedian(listings: ReadonlyArray<ListingForPremium>): number {
  const prices = listings.map(priceOf).filter((p): p is number => p !== null);
  return median(prices);
}

export type TraitPremiumOptions = {
  /** Listings with fewer than this many priced observations are
   *  excluded from results. Default 5. */
  minSample?: number;
  /** Filter results to only traits with absolute |premium| >= this
   *  percentage. Default 0 (no filter). */
  minAbsPremiumPct?: number;
};

export function computeTraitPremiums(
  listings: ReadonlyArray<ListingForPremium>,
  marketMedian: number,
  options: TraitPremiumOptions = {},
): TraitPremium[] {
  const { minSample = 5, minAbsPremiumPct = 0 } = options;
  const traitStats = new Map<string, number[]>();
  for (const l of listings) {
    const p = priceOf(l);
    if (p == null) continue;
    for (const t of traitSet(l)) {
      const arr = traitStats.get(t) ?? [];
      arr.push(p);
      traitStats.set(t, arr);
    }
  }
  const rows: TraitPremium[] = [];
  for (const [trait, prices] of traitStats) {
    if (prices.length < minSample) continue;
    const m = median(prices);
    const premium = marketMedian > 0 ? ((m - marketMedian) / marketMedian) * 100 : 0;
    if (Math.abs(premium) < minAbsPremiumPct) continue;
    const entry: GlossaryEntry | null = lookupMorph(trait);
    rows.push({
      trait,
      displayName: entry?.name ?? trait,
      description: entry?.description ?? null,
      count: prices.length,
      median: m,
      premium,
    });
  }
  return rows;
}
