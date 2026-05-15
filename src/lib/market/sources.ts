// Catalog of data sources that can back a market number. Every badge on
// the dashboard reads from this single source of truth so icons, colors,
// and display labels stay consistent — add a new pipeline here once and
// it lights up everywhere.
import type { SourceId } from "./types";

export type SourceMeta = {
  id: SourceId;
  label: string;
  short: string;          // compact badge text ("GI sales")
  kind: "internal" | "external" | "breeder";
  color: string;          // accent (tailwind ring/dot color)
  description: string;
};

// Ordered — tables render sources in this order for determinism.
export const SOURCES: readonly SourceMeta[] = [
  {
    id: "gi_sales",
    label: "Geck Inspect sales",
    short: "GI sales",
    kind: "internal",
    color: "#0e9a73",
    description: "Confirmed sale events from Geck Inspect users' transaction logs.",
  },
  {
    id: "gi_listings",
    label: "Geck Inspect listings",
    short: "GI listings",
    kind: "internal",
    color: "#2dbf95",
    description: "Live and recently closed listings captured by the Geck Inspect ingest.",
  },
  {
    id: "gi_breeding",
    label: "Geck Inspect breeding",
    short: "GI breeding",
    kind: "internal",
    color: "#6ee7b7",
    description: "Forward-looking supply from user-tracked breeding pairs & clutches.",
  },
  {
    id: "morphmarket",
    label: "MorphMarket",
    short: "MM",
    kind: "external",
    color: "#60a5fa",
    description: "Prices observed from MorphMarket listings and sold badges.",
  },
  {
    id: "pangea",
    label: "Pangea",
    short: "Pangea",
    kind: "external",
    color: "#38bdf8",
    description: "Pangea Reptile retail pricing — skews toward retail establishment pricing.",
  },
  {
    id: "breeder",
    label: "Breeder direct",
    short: "Breeder",
    kind: "breeder",
    color: "#a78bfa",
    description: "Prices volunteered by breeders for their own projects / pairings.",
  },
  {
    id: "fauna",
    label: "Fauna Classifieds",
    short: "Fauna",
    kind: "external",
    color: "#fbbf24",
    description: "Fauna Classifieds ads. Noisy but covers older / niche combos.",
  },
  {
    id: "kijiji",
    label: "Kijiji",
    short: "Kijiji",
    kind: "external",
    color: "#f472b6",
    description: "Kijiji listings, primarily Canadian market signal.",
  },
] as const;

const BY_ID = new Map<SourceId, SourceMeta>(SOURCES.map((s) => [s.id, s]));

// Map raw strings that come back from the database (price_history.source,
// market_listings.scrape_source, etc.) to canonical SourceIds. The
// scraper writes "scraper" today and a small handful of legacy ingests
// wrote "extension_legacy"; both should read as MorphMarket / GI listings
// in the UI, not crash a panel.
const ALIAS_MAP: Readonly<Record<string, SourceId>> = {
  scraper: "morphmarket",
  morphmarket_scrape: "morphmarket",
  extension_legacy: "gi_listings",
  extension_inferred: "gi_listings",
};

export function normalizeSourceId(raw: string | null | undefined): SourceId {
  if (!raw) return "gi_listings";
  if (BY_ID.has(raw as SourceId)) return raw as SourceId;
  const aliased = ALIAS_MAP[raw];
  if (aliased) return aliased;
  return "gi_listings";
}

// Defensive fallback so a stray foreign-source string never crashes a
// render. The UI will show a neutral "Other" pill instead of throwing;
// the caller can normalize first if it wants the alias mapping applied.
const UNKNOWN_META: SourceMeta = {
  id: "gi_listings",
  label: "Other source",
  short: "Other",
  kind: "external",
  color: "#94a3b8",
  description:
    "Source not in the canonical catalog. Probably a legacy ingest value — see normalizeSourceId in src/lib/market/sources.ts.",
};

export function sourceMeta(id: SourceId | string): SourceMeta {
  const m = BY_ID.get(id as SourceId);
  if (m) return m;
  const aliased = ALIAS_MAP[id as string];
  if (aliased) return BY_ID.get(aliased)!;
  return UNKNOWN_META;
}

export const ALL_SOURCE_IDS: readonly SourceId[] = SOURCES.map((s) => s.id);
