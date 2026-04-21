// Deterministic fixtures for the /market dashboard.
//
// Every widget gets its data through this module until real pipelines are
// wired. The seed is derived from the current filter selection, so:
//   - identical filters always return identical numbers (safe to screenshot,
//     safe to talk about in meetings)
//   - changing the timeframe / region / etc. produces a coherent, distinct
//     view, not random noise
//
// Each widget exports a `get…Fixture(filters)` that callers use. When a real
// pipeline is ready, swap the body to a Supabase query without changing the
// public signature; the dashboard keeps working end-to-end during the port.
import type { Attribution, Filters, SourceId, Timeframe } from "./types";
import { ALL_SOURCE_IDS } from "./sources";

// ----------------------------------------------------------------------------
// Mulberry32 — tiny, fast, deterministic PRNG. Not cryptographic; we just
// need same-seed-same-output across page loads.
// ----------------------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit — hashes a string down to a single seed int.
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function filterKey(f: Filters, suffix = ""): string {
  const srcs =
    f.sources === "all" ? "all" : Array.from(f.sources).sort().join(",");
  return [f.timeframe, f.region, f.age, f.lineage, srcs, suffix].join("|");
}

export function seedFor(f: Filters, suffix = ""): number {
  return fnv1a(filterKey(f, suffix));
}

// ----------------------------------------------------------------------------
// Canonical combo list — screenshots use these names; keep them in one place.
// ----------------------------------------------------------------------------
export const COMBOS = [
  "Lilly White × Axanthic",
  "Lilly White × Cappuccino",
  "Cappuccino × Full Pinstripe",
  "Axanthic × Full Pinstripe",
  "Sable × Extreme Harlequin",
  "Frappuccino × Pinstripe",
  "Moonglow × Super Dalmatian",
  "Lilly White × Soft Scale",
  "Axanthic × Extreme Harlequin",
  "Cappuccino × Super Dalmatian",
  "Red Harlequin",
  "Tiger × Pinstripe",
] as const;
export type Combo = (typeof COMBOS)[number];

// ----------------------------------------------------------------------------
// Market Index — weighted basket of high-value trait combinations.
// Point series is normalized so the period-start == 1000.
// ----------------------------------------------------------------------------
export type IndexPoint = { t: string; v: number };

export type MarketIndex = {
  value: number;
  deltaPct: number;
  series: IndexPoint[];
  attribution: Attribution;
};

const TIMEFRAME_MONTHS: Record<Timeframe, number> = {
  "30d": 1,
  "90d": 3,
  "6mo": 6,
  "12mo": 12,
  "24mo": 24,
};

export function getMarketIndex(f: Filters): MarketIndex {
  const rand = mulberry32(seedFor(f, "index"));
  const n = Math.max(12, TIMEFRAME_MONTHS[f.timeframe] * 4); // ~weekly ticks
  const series: IndexPoint[] = [];
  let v = 1000;
  const drift = (rand() - 0.45) * 0.02; // slight upward bias per step
  for (let i = 0; i < n; i++) {
    const noise = (rand() - 0.5) * 0.08;
    v = v * (1 + drift + noise);
    const t = timeIndexLabel(f.timeframe, i, n);
    series.push({ t, v: Math.round(v) });
  }
  const value = series[series.length - 1]!.v;
  const start = series[0]!.v;
  const deltaPct = ((value - start) / start) * 100;

  return {
    value,
    deltaPct,
    series,
    attribution: synthesizeAttribution(f, rand, 7, 70),
  };
}

function timeIndexLabel(tf: Timeframe, i: number, n: number): string {
  // A simple YYYY-MM label that trends toward "now"; good enough for the
  // chart hover tooltip in preview mode.
  const now = new Date();
  const monthsBack = ((n - 1 - i) / n) * TIMEFRAME_MONTHS[tf];
  const d = new Date(now);
  d.setDate(1);
  d.setMonth(d.getMonth() - Math.round(monthsBack));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ----------------------------------------------------------------------------
// Top Movers — combos with the biggest % swings in the window.
// ----------------------------------------------------------------------------
export type Mover = {
  combo: Combo;
  avgPrice: number;
  n: number;
  deltaPct: number;      // signed
  spark: number[];       // 12-ish points
  attribution: Attribution;
};

export function getTopMovers(f: Filters): { appreciating: Mover[]; depreciating: Mover[] } {
  const rand = mulberry32(seedFor(f, "movers"));
  const rows: Mover[] = COMBOS.map((combo) => {
    const deltaPct = (rand() * 120 - 30); // -30..+90
    const avgPrice = 500 + Math.floor(rand() * 4500);
    const n = 10 + Math.floor(rand() * 30);
    const spark = Array.from({ length: 12 }, (_, i) => {
      const base = 1 + deltaPct / 100;
      return 1 + ((i / 11) * (base - 1)) + (rand() - 0.5) * 0.15;
    });
    return {
      combo,
      avgPrice,
      n,
      deltaPct,
      spark,
      attribution: synthesizeAttribution(f, rand, 3, 55),
    };
  });
  const byDelta = [...rows].sort((a, b) => b.deltaPct - a.deltaPct);
  return {
    appreciating: byDelta.slice(0, 5),
    depreciating: [...byDelta].reverse().slice(0, 5),
  };
}

// ----------------------------------------------------------------------------
// Market Calendar — upcoming expos + breeder releases.
// ----------------------------------------------------------------------------
export type CalendarEntry = {
  label: string;
  region: string;
  date: string;     // ISO date
  kind: "expo" | "release";
};

const CALENDAR_SEED: CalendarEntry[] = [
  { label: "Tinley Park Herpetoculture", region: "US",  date: "2026-04-13", kind: "expo" },
  { label: "Houston Reptile Expo",       region: "US",  date: "2026-05-04", kind: "expo" },
  { label: "Ridgeback Q2 release drop",  region: "US",  date: "2026-05-11", kind: "release" },
  { label: "Hamm Terraristika",          region: "EU",  date: "2026-06-01", kind: "expo" },
  { label: "Kodama Reptiles summer drop",region: "JP",  date: "2026-06-19", kind: "release" },
  { label: "Nordic Morph Works release", region: "SE",  date: "2026-07-09", kind: "release" },
];

export function getMarketCalendar(_f: Filters): CalendarEntry[] {
  return CALENDAR_SEED;
}

// ----------------------------------------------------------------------------
// Attribution synthesizer. Picks N sources honoring the filter, and assigns
// each a contribution weight that sums to 100%.
// ----------------------------------------------------------------------------
export function synthesizeAttribution(
  f: Filters,
  rand: () => number,
  nSources = 3,
  baseConfidence = 50,
): Attribution {
  const allowed: SourceId[] =
    f.sources === "all" ? [...ALL_SOURCE_IDS] : Array.from(f.sources);
  const pool = allowed.length > 0 ? allowed : [...ALL_SOURCE_IDS];
  const shuffled = [...pool].sort(() => rand() - 0.5);
  const pick = shuffled.slice(0, Math.min(nSources, shuffled.length));
  const weights = pick.map(() => rand() + 0.1);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const amount0 = 200 + Math.floor(rand() * 2800);
  const blend = pick.map((id, i) => ({
    source: id,
    n: 1 + Math.floor(rand() * 12),
    amount: Math.round((weights[i]! / totalW) * amount0),
    pct: Math.round((weights[i]! / totalW) * 100),
  }));
  // Normalize rounding so pct sums to 100.
  const pctSum = blend.reduce((a, b) => a + b.pct, 0);
  if (blend.length > 0 && pctSum !== 100) {
    blend[0]!.pct += 100 - pctSum;
  }
  return {
    sources: pick,
    blend,
    confidence: {
      score: Math.max(
        5,
        Math.min(99, Math.round(baseConfidence + (rand() - 0.5) * 30)),
      ),
    },
  };
}

