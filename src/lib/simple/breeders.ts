// Plain-language descriptions of a breeder, built from breeder_market_v.
//
// Marketplace research (eBay, Etsy, MorphMarket reviews) says buyers judge
// a seller on a few things: how established they are, what they specialize
// in, and whether their prices are fair. Buyers also rarely open detailed
// profiles, so the key signal has to sit on the card they already see.
// These helpers turn the numbers into those few short phrases.

import type { Breeder } from "./data";

/** Minimum priced listings before we describe how a breeder prices. */
export const MIN_PRICED = 5;

export type Pricing = "below" | "at" | "above";

export function pricing(b: Breeder): Pricing | null {
  if (b.priceRatio == null || b.pricedN < MIN_PRICED) return null;
  if (b.priceRatio < 0.9) return "below";
  if (b.priceRatio > 1.1) return "above";
  return "at";
}

export function pricingPhrase(b: Breeder): string | null {
  const p = pricing(b);
  if (!p || b.priceRatio == null) return null;
  const pct = Math.round(Math.abs(1 - b.priceRatio) * 100);
  if (p === "at") return "Prices in line with similar geckos";
  return p === "below"
    ? `Prices about ${pct}% below similar geckos`
    : `Prices about ${pct}% above similar geckos`;
}

export type Stage = "hatchlings" | "grown" | "mixed";

export function stage(b: Breeder): Stage | null {
  if (b.shareHatchling == null) return null;
  if (b.shareHatchling >= 0.6) return "hatchlings";
  if (b.shareHatchling <= 0.2) return "grown";
  return "mixed";
}

export function stagePhrase(b: Breeder): string | null {
  const s = stage(b);
  if (!s) return null;
  if (s === "hatchlings") return "Mostly sells hatchlings";
  if (s === "grown") return "Mostly sells grown geckos";
  return "Sells hatchlings and grown geckos";
}

export function activeSince(b: Breeder): string | null {
  if (!b.firstSeenAt) return null;
  return new Date(b.firstSeenAt).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Share of a breeder's morph-tagged listings that carry each top trait. */
export function focus(b: Breeder): Array<{ trait: string; count: number; share: number }> {
  const total = b.forSale + b.sold;
  return b.topTraits.map((trait, i) => {
    const count = b.topTraitCounts[i] ?? 0;
    return { trait, count, share: total ? Math.min(count / total, 1) : 0 };
  });
}

/** Breeders whose focus overlaps most with this one, excluding itself. */
export function similarBreeders(b: Breeder, all: Breeder[], limit = 4): Breeder[] {
  const mine = new Set(b.topTraits.slice(0, 3));
  return all
    .filter((o) => o.slug !== b.slug && o.forSale > 0)
    .map((o) => ({ o, score: o.topTraits.slice(0, 3).filter((t) => mine.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, z) => z.score - a.score || z.o.forSale - a.o.forSale)
    .slice(0, limit)
    .map((x) => x.o);
}
