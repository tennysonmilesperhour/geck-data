// Shared types for the /market dashboard. Filters drive both the fixtures
// seed (so numbers stay deterministic while pipelines are stubbed) and —
// once we swap in real data — the Supabase query shape.

export const TIMEFRAMES = ["30d", "90d", "6mo", "12mo", "24mo"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const REGIONS = ["ALL", "US", "EU", "UK", "CA", "AU", "JP", "SE", "SEA"] as const;
export type Region = (typeof REGIONS)[number];

export const AGES = ["any", "juvenile", "subadult", "adult", "proven"] as const;
export type Age = (typeof AGES)[number];

export const LINEAGES = ["any", "founder", "project", "proven_breeder"] as const;
export type Lineage = (typeof LINEAGES)[number];

export const TABS = [
  "overview",
  "combos",
  "regional",
  "arbitrage",
  "supply",
  "breeders",
] as const;
export type Tab = (typeof TABS)[number];

// Source tag — shown on every number. See src/lib/market/sources.ts for the
// full catalog. The dashboard filters a set of these; "all" means include
// every known source.
export type SourceId =
  | "gi_sales"
  | "gi_listings"
  | "gi_breeding"
  | "pangea"
  | "morphmarket"
  | "breeder"
  | "fauna"
  | "kijiji";

export type Filters = {
  timeframe: Timeframe;
  region: Region;
  age: Age;
  lineage: Lineage;
  sources: Set<SourceId> | "all";
};

// Confidence — uniform 0..100 score + tier label. Cards/badges compute the
// label from the number so callers only need to set one value.
export type Confidence = {
  score: number; // 0..100
};

export type ConfidenceTier = "Very low" | "Low" | "Medium" | "High";

export function tierFor(score: number): ConfidenceTier {
  if (score < 25) return "Very low";
  if (score < 50) return "Low";
  if (score < 80) return "Medium";
  return "High";
}

// Attribution — one per number we render. `blend` is present on composites
// (blended price, market index) and shows the contribution mix.
export type Attribution = {
  sources: SourceId[];
  blend?: Array<{ source: SourceId; n: number; amount: number; pct: number }>;
  confidence: Confidence;
};
