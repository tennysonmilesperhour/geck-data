// Canonical URL-state schema for cross-page filters.
//
// Every page that renders filterable market data reads from and writes
// to this schema. The keys are stable; query strings shaped by this
// module survive nav, refresh, and share. Default values are not
// serialised so a clean URL stays clean.
//
// Keys (all optional):
//   tf        timeframe          30d | 90d | 6mo | 12mo | 24mo
//   region    region code        US | EU | UK | CA | AU | JP | SE | SEA | ALL
//   age       maturity           any | juvenile | subadult | adult | proven
//   lineage   lineage tier       any | founder | project | proven_breeder
//   sex       sex                any | male | female | unknown
//   combos    canonical ids      comma sep, see HIGH_VALUE_COMBOS
//   traits    trait slugs        comma sep, slugified ("lilly-white")
//   sellers   seller ids         comma sep
//   priceMin  number              USD
//   priceMax  number              USD
//   from      ISO yyyy-mm-dd      window start (overrides tf when set)
//   to        ISO yyyy-mm-dd      window end
//   sources   source ids         comma sep, see lib/market/sources
//   sort      sort key            free-form, page-defined
//
// Parsing is permissive: unknown values fall back to the page default
// rather than throwing, so a stale link never errors.

import { AGES, LINEAGES, REGIONS, TIMEFRAMES } from "@/lib/market/types";
import type {
  Age,
  Filters as MarketFilters,
  Lineage,
  Region,
  SourceId,
  Timeframe,
} from "@/lib/market/types";
import { ALL_SOURCE_IDS } from "@/lib/market/sources";

export const SEXES = ["any", "male", "female", "unknown"] as const;
export type Sex = (typeof SEXES)[number];

export type CanonicalFilters = {
  tf: Timeframe;
  region: Region;
  age: Age;
  lineage: Lineage;
  sex: Sex;
  combos: string[];
  traits: string[];
  sellers: string[];
  priceMin: number | null;
  priceMax: number | null;
  from: string | null;
  to: string | null;
  sources: Set<SourceId> | "all";
  sort: string | null;
};

export const DEFAULTS: CanonicalFilters = {
  tf: "12mo",
  region: "ALL",
  age: "any",
  lineage: "any",
  sex: "any",
  combos: [],
  traits: [],
  sellers: [],
  priceMin: null,
  priceMax: null,
  from: null,
  to: null,
  sources: "all",
  sort: null,
};

// Type guards over the small enums. Falls back to default on miss so
// stale or malformed URLs never throw.
function asTimeframe(v: string | null | undefined): Timeframe {
  return TIMEFRAMES.includes(v as Timeframe) ? (v as Timeframe) : DEFAULTS.tf;
}
function asRegion(v: string | null | undefined): Region {
  return REGIONS.includes(v as Region) ? (v as Region) : DEFAULTS.region;
}
function asAge(v: string | null | undefined): Age {
  return AGES.includes(v as Age) ? (v as Age) : DEFAULTS.age;
}
function asLineage(v: string | null | undefined): Lineage {
  return LINEAGES.includes(v as Lineage) ? (v as Lineage) : DEFAULTS.lineage;
}
function asSex(v: string | null | undefined): Sex {
  return SEXES.includes(v as Sex) ? (v as Sex) : DEFAULTS.sex;
}

function csv(v: string | null | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function asSources(v: string | null | undefined): Set<SourceId> | "all" {
  if (!v || v === "all") return "all";
  const want = new Set(csv(v));
  const ok = ALL_SOURCE_IDS.filter((id) => want.has(id));
  if (ok.length === 0) return "all";
  if (ok.length === ALL_SOURCE_IDS.length) return "all";
  return new Set(ok);
}

function asNum(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asDate(v: string | null | undefined): string | null {
  if (!v) return null;
  // Permissive yyyy-mm-dd check; deeper validation happens at the
  // consumer when it parses the date.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Read from a generic source: URLSearchParams, plain object, or
// Next.js searchParams record.
type Reader = {
  get(key: string): string | null | undefined;
};

function makeReader(
  src: URLSearchParams | Record<string, string | string[] | undefined>,
): Reader {
  if (src instanceof URLSearchParams) {
    return { get: (k) => src.get(k) };
  }
  return {
    get(k) {
      const v = src[k];
      if (Array.isArray(v)) return v[0] ?? null;
      return v ?? null;
    },
  };
}

export function parseFilters(
  src:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | undefined
    | null,
): CanonicalFilters {
  if (!src) return DEFAULTS;
  const r = makeReader(src);
  return {
    tf: asTimeframe(r.get("tf")),
    region: asRegion(r.get("region")),
    age: asAge(r.get("age")),
    lineage: asLineage(r.get("lineage")),
    sex: asSex(r.get("sex")),
    combos: csv(r.get("combos")),
    traits: csv(r.get("traits")),
    sellers: csv(r.get("sellers")),
    priceMin: asNum(r.get("priceMin")),
    priceMax: asNum(r.get("priceMax")),
    from: asDate(r.get("from")),
    to: asDate(r.get("to")),
    sources: asSources(r.get("sources")),
    sort: r.get("sort") || null,
  };
}

// Serialise back to a URLSearchParams. Default values are omitted so
// a clean URL stays clean. Pass `current` to preserve unknown keys
// the caller wants to keep alongside (e.g. `page`).
export function serialiseFilters(
  f: Partial<CanonicalFilters>,
  current?: URLSearchParams,
): URLSearchParams {
  const out = new URLSearchParams(current?.toString() ?? "");
  // Drop every canonical key first so we can write a clean projection.
  for (const k of CANONICAL_KEYS) out.delete(k);
  const merged: CanonicalFilters = { ...DEFAULTS, ...f };

  function setIfNotDefault<K extends keyof CanonicalFilters>(
    key: K,
    encode: (v: CanonicalFilters[K]) => string | null,
  ): void {
    const v = encode(merged[key]);
    if (v != null && v !== "") out.set(key as string, v);
  }

  setIfNotDefault("tf", (v) => (v === DEFAULTS.tf ? null : v));
  setIfNotDefault("region", (v) => (v === DEFAULTS.region ? null : v));
  setIfNotDefault("age", (v) => (v === DEFAULTS.age ? null : v));
  setIfNotDefault("lineage", (v) => (v === DEFAULTS.lineage ? null : v));
  setIfNotDefault("sex", (v) => (v === DEFAULTS.sex ? null : v));
  setIfNotDefault("combos", (v) => (v.length ? v.join(",") : null));
  setIfNotDefault("traits", (v) => (v.length ? v.join(",") : null));
  setIfNotDefault("sellers", (v) => (v.length ? v.join(",") : null));
  setIfNotDefault("priceMin", (v) => (v == null ? null : String(v)));
  setIfNotDefault("priceMax", (v) => (v == null ? null : String(v)));
  setIfNotDefault("from", (v) => v);
  setIfNotDefault("to", (v) => v);
  setIfNotDefault("sources", (v) =>
    v === "all" ? null : Array.from(v).sort().join(","),
  );
  setIfNotDefault("sort", (v) => v);
  return out;
}

export const CANONICAL_KEYS = [
  "tf",
  "region",
  "age",
  "lineage",
  "sex",
  "combos",
  "traits",
  "sellers",
  "priceMin",
  "priceMax",
  "from",
  "to",
  "sources",
  "sort",
] as const;

// Bridge: produce the legacy MarketFilters shape used by
// src/components/market/* and lib/market/queries.ts. Drops the keys
// the legacy shape does not understand.
export function toMarketFilters(f: CanonicalFilters): MarketFilters {
  return {
    timeframe: f.tf,
    region: f.region,
    age: f.age,
    lineage: f.lineage,
    sources: f.sources,
  };
}

// Lift a partial change up into the canonical shape, useful for
// the existing FilterBar onChange callbacks which only send
// MarketFilters back.
export function withMarketFilters(
  base: CanonicalFilters,
  m: MarketFilters,
): CanonicalFilters {
  return {
    ...base,
    tf: m.timeframe,
    region: m.region,
    age: m.age,
    lineage: m.lineage,
    sources: m.sources,
  };
}

// Trait slugifier. Stable, reversible enough for our trait vocabulary.
// "Lilly White" -> "lilly-white"; "Full Pinstripe" -> "full-pinstripe".
export function slugifyTrait(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Reverse: best-effort. The trait vocab table is the source of truth
// in queries; this is for display when no DB lookup is available.
export function unslugTrait(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
