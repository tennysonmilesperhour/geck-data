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
import { ALL_SOURCE_IDS, sourceMeta } from "./sources";

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
// Peak Indicator — composite 0..100 "is this combo peaking or still early?"
// score used on the Overview tab.
//   0..34   Accumulate (green gradient bar lives on the left)
//   35..69  Fair value (middle)
//   70..100 Peaking    (right — "sell into strength")
// Attribution follows the same shape as everything else so the click-through
// story is consistent.
// ----------------------------------------------------------------------------
export type PeakTier = "Peaking" | "Fair value" | "Accumulate";

export type PeakIndicator = {
  combo: Combo;
  score: number;             // 0..100
  tier: PeakTier;
  action: string;            // "Sell into strength" / "Hold" / "Accumulate"
  n: number;
  attribution: Attribution;
};

export function tierForScore(score: number): PeakTier {
  if (score >= 70) return "Peaking";
  if (score >= 35) return "Fair value";
  return "Accumulate";
}

export function actionForScore(score: number): string {
  if (score >= 70) return "Sell into strength";
  if (score >= 35) return "Hold";
  return "Accumulate";
}

export function getPeakIndicators(f: Filters): PeakIndicator[] {
  const rand = mulberry32(seedFor(f, "peak"));
  const rows: PeakIndicator[] = COMBOS.map((combo) => {
    // Distribute scores across the full 5..95 range so every filter state
    // produces a mix of peaking / fair / accumulate cards to look at.
    const score = 5 + Math.floor(rand() * 90);
    return {
      combo,
      score,
      tier: tierForScore(score),
      action: actionForScore(score),
      n: 8 + Math.floor(rand() * 30),
      attribution: synthesizeAttribution(f, rand, 3, 45),
    };
  });
  return rows.sort((a, b) => b.score - a.score).slice(0, 6);
}

// ----------------------------------------------------------------------------
// Combos tab — ranked table + per-combo detail.
//
// getCombosRanked returns one row per known combo, sortable by multiple
// metrics. getComboDetail returns the selected combo's multi-series price
// chart (sold median, ask median, internal avg, external avg, upper band)
// plus blended price contribution and summary metrics.
// ----------------------------------------------------------------------------
export type ComboRow = {
  combo: Combo;
  traits: [string, string];     // split for the sub-label under the combo name
  medianSold: number;
  stddev: number;
  ask: number;
  spreadPct: number;            // (ask - sold) / sold * 100
  daysToSell: number;
  volume: number;
  attribution: Attribution;
};

export type ComboRankSort =
  | "volume"
  | "medianSold"
  | "ask"
  | "spread"
  | "days";

export function getCombosRanked(
  f: Filters,
  sort: ComboRankSort = "volume",
): ComboRow[] {
  const rand = mulberry32(seedFor(f, "combos-ranked"));
  const rows: ComboRow[] = COMBOS.map((combo) => {
    const medianSold = 500 + Math.floor(rand() * 4500);
    const stddev = Math.floor(medianSold * (0.12 + rand() * 0.2));
    const ask = Math.round(medianSold * (0.9 + rand() * 0.4));
    const spreadPct = ((ask - medianSold) / medianSold) * 100;
    const daysToSell = 25 + Math.floor(rand() * 20);
    const volume = 10 + Math.floor(rand() * 30);
    const parts = combo.split(" × ");
    return {
      combo,
      traits: [parts[0] ?? combo, parts[1] ?? ""],
      medianSold,
      stddev,
      ask,
      spreadPct,
      daysToSell,
      volume,
      attribution: synthesizeAttribution(f, rand, 3, 48),
    };
  });
  return sortComboRows(rows, sort);
}

export function sortComboRows(rows: ComboRow[], sort: ComboRankSort): ComboRow[] {
  const keyFn: Record<ComboRankSort, (r: ComboRow) => number> = {
    volume: (r) => r.volume,
    medianSold: (r) => r.medianSold,
    ask: (r) => r.ask,
    spread: (r) => Math.abs(r.spreadPct),
    days: (r) => -r.daysToSell, // fewer days = better
  };
  return [...rows].sort((a, b) => keyFn[sort](b) - keyFn[sort](a));
}

// Multi-series time chart — mirrors the Combos detail panel screenshot
// (Upper band / Sold median / Ask median / Internal avg / External avg).
export type MultiSeries = {
  name: string;
  color: string;
  dashed?: boolean;
  points: IndexPoint[];
};

export type ComboDetail = {
  combo: Combo;
  medianSold: number;
  range: [number, number];
  observations: number;
  series: MultiSeries[];
  blend: Array<{ source: SourceId; n: number; amount: number; pct: number; label: string }>;
  keyMetrics: {
    medianAsk: number;
    askSoldSpreadPct: number;
    daysToSell: number;
    volume: number;
  };
  attribution: Attribution;
};

export function getComboDetail(f: Filters, combo: Combo | null): ComboDetail | null {
  if (!combo) return null;
  const rand = mulberry32(seedFor(f, `combo-detail-${combo}`));
  const n = Math.max(12, TIMEFRAME_MONTHS[f.timeframe] * 4);

  // Build five correlated-but-distinct series. Sold median leads; ask is
  // biased a bit above it; internal/external averages oscillate around it;
  // upper band rides +stddev.
  const sold = walk(rand, 1800, n, 0.015, 0.12);
  const ask = sold.map((p) => ({ t: p.t, v: Math.round(p.v * (1 + 0.06 * (rand() - 0.3))) }));
  const internal = sold.map((p) => ({ t: p.t, v: Math.round(p.v * (0.9 + 0.2 * rand())) }));
  const external = sold.map((p) => ({ t: p.t, v: Math.round(p.v * (1.05 + 0.2 * (rand() - 0.5))) }));
  const upper = sold.map((p) => ({ t: p.t, v: Math.round(p.v * 1.35) }));

  const attribution = synthesizeAttribution(f, rand, 4, 52);
  const medianSoldLatest = sold[sold.length - 1]!.v;
  const range: [number, number] = [
    Math.min(...sold.map((p) => p.v)),
    Math.max(...sold.map((p) => p.v)),
  ];

  // Translate the attribution.blend into a displayable shape (with source
  // labels resolved from the SOURCES catalog).
  const blend = (attribution.blend ?? []).map((b) => ({
    source: b.source,
    n: b.n,
    amount: b.amount,
    pct: b.pct,
    label: sourceMeta(b.source).short,
  }));

  return {
    combo,
    medianSold: medianSoldLatest,
    range,
    observations: 20 + Math.floor(rand() * 40),
    series: [
      { name: "Upper band",    color: "#10b98166", dashed: true, points: upper },
      { name: "Sold (median)", color: "#34d399",                  points: sold },
      { name: "Ask (median)",  color: "#a78bfa",   dashed: true, points: ask },
      { name: "Internal avg",  color: "#fbbf24",                  points: internal },
      { name: "External avg",  color: "#38bdf8",                  points: external },
    ],
    blend,
    keyMetrics: {
      medianAsk: Math.round(medianSoldLatest * (1 + (rand() * 0.15))),
      askSoldSpreadPct: Math.round(((rand() - 0.4) * 20) * 10) / 10,
      daysToSell: 25 + Math.floor(rand() * 20),
      volume: 12 + Math.floor(rand() * 30),
    },
    attribution,
  };
}

// Smooth-ish random walk helper for the detail chart. Kept local to
// fixtures so the PRNG is seeded consistently.
function walk(
  rand: () => number,
  start: number,
  n: number,
  driftBias: number,
  volatility: number,
): IndexPoint[] {
  const out: IndexPoint[] = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.4) * driftBias;
    const shock = (rand() - 0.5) * volatility;
    v = Math.max(50, v * (1 + drift + shock));
    out.push({ t: timeLabel(i, n), v: Math.round(v) });
  }
  return out;
}

function timeLabel(i: number, n: number): string {
  const now = new Date();
  const monthsBack = ((n - 1 - i) / n) * 12;
  const d = new Date(now);
  d.setDate(1);
  d.setMonth(d.getMonth() - Math.round(monthsBack));
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

// ----------------------------------------------------------------------------
// Regional tab — combo × market heatmap.
//
// Produces one cell per (combo, region). `value` is the chosen metric (median
// sold by default), `confidence` 0..1 drives the cell's opacity, and `null`
// means "no data" so the cell renders as "—" (thin supply).
// ----------------------------------------------------------------------------
export const REGION_COLUMNS = ["US", "EU", "UK", "CA", "AU", "JP", "SE", "SEA"] as const;
export type RegionKey = (typeof REGION_COLUMNS)[number];

export type HeatmapMetric = "medianSold" | "ask" | "spread";

export type HeatmapCell = {
  value: number;
  confidence: number; // 0..1, drives opacity
  n: number;
} | null;

export type HeatmapRow = {
  combo: Combo;
  cells: Record<RegionKey, HeatmapCell>;
};

export type RegionalHeatmap = {
  metric: HeatmapMetric;
  rows: HeatmapRow[];
  range: [number, number];
  attribution: Attribution;
};

export function getRegionalHeatmap(
  f: Filters,
  metric: HeatmapMetric = "medianSold",
): RegionalHeatmap {
  const rand = mulberry32(seedFor(f, `heatmap-${metric}`));
  let lo = Infinity;
  let hi = -Infinity;

  const rows: HeatmapRow[] = COMBOS.map((combo) => {
    // Empty shell first so the type checker sees every region key populated.
    const cells: Record<RegionKey, HeatmapCell> = {
      US: null, EU: null, UK: null, CA: null,
      AU: null, JP: null, SE: null, SEA: null,
    };
    for (const region of REGION_COLUMNS) {
      // ~15% of cells render as "—" so the grid reads as uneven real-world
      // supply instead of a solid rectangle.
      if (rand() < 0.15) {
        cells[region] = null;
        continue;
      }
      const base = metricBase(metric, rand);
      const regional = base * regionMultiplier(region, rand);
      const value = Math.round(Math.max(0, regional));
      const confidence = Math.min(1, 0.25 + rand() * 0.7);
      cells[region] = { value, confidence, n: 1 + Math.floor(rand() * 10) };
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    return { combo, cells };
  });

  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi)) hi = 1;

  return {
    metric,
    rows,
    range: [lo, hi],
    attribution: synthesizeAttribution(f, rand, 4, 50),
  };
}

function metricBase(metric: HeatmapMetric, rand: () => number): number {
  switch (metric) {
    case "medianSold":
      return 400 + Math.floor(rand() * 6000);
    case "ask":
      return 500 + Math.floor(rand() * 7000);
    case "spread":
      // Spread is a percent, not a dollar amount. Keep it small and signed.
      return (rand() - 0.4) * 30;
  }
}

function regionMultiplier(region: RegionKey, rand: () => number): number {
  // Light regional bias on top of a per-cell random wobble. Keeps the map
  // interpretable across metrics — UK tends higher, SEA tends lower, etc.
  const base: Record<RegionKey, number> = {
    US: 1.0,
    EU: 1.05,
    UK: 1.15,
    CA: 0.95,
    AU: 1.1,
    JP: 1.0,
    SE: 1.05,
    SEA: 0.85,
  };
  return base[region] * (0.75 + rand() * 0.6);
}

export function heatmapMetricLabel(m: HeatmapMetric): string {
  switch (m) {
    case "medianSold":
      return "Median sold";
    case "ask":
      return "Ask";
    case "spread":
      return "Ask→Sold spread";
  }
}

// ----------------------------------------------------------------------------
// Arbitrage tab — spread opportunities.
//
// Two axes we can arbitrage along:
//   - By source: where one feed quotes a combo meaningfully cheaper or
//     dearer than another (GI listings vs Pangea vs Breeder, etc.)
//   - By region: where a combo is cheap in region A and dear in region B
//     (think: buy in US, ship to JP)
//
// For each combo, we find the min/max leg in the selected axis and expose
// a row with the spread in dollars and percent.
// ----------------------------------------------------------------------------
export type ArbitrageAxis = "source" | "region";

export type ArbitrageRow = {
  combo: Combo;
  low: { label: string; tag: string; price: number; n: number };
  high: { label: string; tag: string; price: number; n: number };
  spreadAbs: number;
  spreadPct: number;
  attribution: Attribution;
};

export type Arbitrage = {
  axis: ArbitrageAxis;
  rows: ArbitrageRow[];
  kpis: {
    biggestPct: number;
    avgPct: number;
    opportunities: number; // rows with spreadPct >= 10
  };
};

export function getArbitrage(f: Filters, axis: ArbitrageAxis): Arbitrage {
  const rand = mulberry32(seedFor(f, `arb-${axis}`));
  const rows: ArbitrageRow[] = COMBOS.map((combo) => {
    if (axis === "source") {
      return arbRowBySource(f, combo, rand);
    }
    return arbRowByRegion(f, combo, rand);
  })
    // Drop ties (synthetic equal prices) so the list is always informative.
    .filter((r) => r.spreadAbs > 0)
    .sort((a, b) => b.spreadPct - a.spreadPct);

  const pcts = rows.map((r) => r.spreadPct);
  const biggest = pcts[0] ?? 0;
  const avg =
    pcts.length === 0 ? 0 : pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const opportunities = pcts.filter((p) => p >= 10).length;

  return {
    axis,
    rows: rows.slice(0, 10),
    kpis: {
      biggestPct: biggest,
      avgPct: avg,
      opportunities,
    },
  };
}

function arbRowBySource(
  f: Filters,
  combo: Combo,
  rand: () => number,
): ArbitrageRow {
  const pool: SourceId[] =
    f.sources === "all" ? [...ALL_SOURCE_IDS] : Array.from(f.sources);
  const chosen =
    pool.length >= 2
      ? pool
      : ([...ALL_SOURCE_IDS].sort(() => rand() - 0.5) as SourceId[]);
  const quotes = chosen.map((id) => ({
    id,
    price: 400 + Math.floor(rand() * 4500),
    n: 1 + Math.floor(rand() * 12),
  }));
  quotes.sort((a, b) => a.price - b.price);
  const low = quotes[0]!;
  const high = quotes[quotes.length - 1]!;
  const spreadAbs = high.price - low.price;
  const spreadPct = low.price === 0 ? 0 : (spreadAbs / low.price) * 100;
  return {
    combo,
    low: {
      label: sourceMeta(low.id).short,
      tag: "buy",
      price: low.price,
      n: low.n,
    },
    high: {
      label: sourceMeta(high.id).short,
      tag: "sell",
      price: high.price,
      n: high.n,
    },
    spreadAbs,
    spreadPct,
    attribution: synthesizeAttribution(f, rand, 3, 52),
  };
}

// ----------------------------------------------------------------------------
// Supply tab — projected hatchlings (9-month). Stacked by combo per month.
// Forward-looking signal assembled from user-tracked breeding pairs on the
// Geck Inspect side (the screenshots' enterprise-only badge copy).
// ----------------------------------------------------------------------------
export type SupplyMonth = {
  monthLabel: string;                     // e.g. "Apr 26"
  perCombo: Array<{ combo: Combo; n: number; color: string }>;
  total: number;
};

export type SupplyPipeline = {
  activePairs: number;
  projectedNine: number;
  peakMonth: string;
  months: SupplyMonth[];
};

const SUPPLY_COLORS: readonly string[] = [
  "#34d399", "#60a5fa", "#a78bfa", "#f472b6",
  "#fbbf24", "#fb7185", "#22d3ee", "#c084fc",
  "#4ade80", "#fde047", "#f97316", "#38bdf8",
];

// ----------------------------------------------------------------------------
// Breeders tab — ranked breeders with activity + specialty + recent velocity.
// No screenshot for this one; designed to surface "who's shipping volume,
// at what price, with what lineage weight" so an analyst can skim for
// whose listings to watch.
// ----------------------------------------------------------------------------
const BREEDER_NAMES = [
  "Ridgeback Reptiles",
  "Kodama Koncepts",
  "Nordic Morph Works",
  "Pangea Select",
  "Crested Cape",
  "Axanthic Alchemy",
  "Moonglow Morphs",
  "Lilly Lab",
  "Harlequin Haven",
  "Sable Selects",
  "Pinstripe Provisions",
  "Full Spectrum Reptiles",
] as const;

const BREEDER_REGIONS: RegionKey[] = ["US", "US", "EU", "UK", "CA", "AU", "JP", "SE", "US", "EU", "UK", "SEA"];

export type BreederRow = {
  name: string;
  region: RegionKey;
  activeListings: number;
  soldInWindow: number;
  avgSoldPrice: number;
  avgDaysToSell: number;
  specialty: Combo;
  velocity: number[];          // 12-week sparkline of new listings
  lineageScore: number;        // 0..100; higher = stronger project/proven
  attribution: Attribution;
};

export type BreedersData = {
  rows: BreederRow[];
  kpis: {
    totalBreeders: number;
    topRegion: RegionKey;
    avgSoldPrice: number;
    avgDaysToSell: number;
  };
};

export function getBreeders(f: Filters): BreedersData {
  const rand = mulberry32(seedFor(f, "breeders"));

  const rows: BreederRow[] = BREEDER_NAMES.map((name, i) => {
    const velocity = Array.from({ length: 12 }, () =>
      Math.max(0, Math.round(2 + rand() * 10)),
    );
    const activeListings = 4 + Math.floor(rand() * 40);
    const soldInWindow = 2 + Math.floor(rand() * 30);
    const avgSoldPrice = 800 + Math.floor(rand() * 4500);
    const avgDaysToSell = 18 + Math.floor(rand() * 28);
    const specialty =
      COMBOS[Math.floor(rand() * COMBOS.length)] ?? COMBOS[0]!;
    const lineageScore = 30 + Math.floor(rand() * 65);
    return {
      name,
      region: BREEDER_REGIONS[i] ?? "US",
      activeListings,
      soldInWindow,
      avgSoldPrice,
      avgDaysToSell,
      specialty,
      velocity,
      lineageScore,
      attribution: synthesizeAttribution(f, rand, 3, 55),
    };
  }).sort((a, b) => b.soldInWindow - a.soldInWindow);

  const byRegion = new Map<RegionKey, number>();
  for (const r of rows) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + 1);
  const topRegion = [...byRegion.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "US";

  return {
    rows,
    kpis: {
      totalBreeders: rows.length,
      topRegion,
      avgSoldPrice: Math.round(
        rows.reduce((a, r) => a + r.avgSoldPrice, 0) / Math.max(1, rows.length),
      ),
      avgDaysToSell: Math.round(
        rows.reduce((a, r) => a + r.avgDaysToSell, 0) / Math.max(1, rows.length),
      ),
    },
  };
}

export function getSupplyPipeline(f: Filters): SupplyPipeline {
  const rand = mulberry32(seedFor(f, "supply"));
  // Monthly profile — ramps up to a summer peak then drops off, so the
  // chart reads as a breeding-season shape (matches the screenshot).
  const profile = [0.2, 0.35, 0.75, 1.0, 1.0, 0.65, 0.55, 0.35, 0.2];
  const months: SupplyMonth[] = [];
  let activePairs = 0;
  let peakTotal = -Infinity;
  let peakIdx = 0;

  const now = new Date();
  for (let i = 0; i < profile.length; i++) {
    const d = new Date(now);
    d.setDate(1);
    d.setMonth(now.getMonth() + i);
    const label = d.toLocaleString("en-US", { month: "short", year: "2-digit" });

    const perCombo = COMBOS.slice(0, 12).map((combo, idx) => {
      const n = Math.max(0, Math.round(profile[i]! * (5 + rand() * 18)));
      activePairs += n > 0 ? 1 : 0;
      return {
        combo,
        n,
        color: SUPPLY_COLORS[idx % SUPPLY_COLORS.length]!,
      };
    });
    const total = perCombo.reduce((a, b) => a + b.n, 0);
    if (total > peakTotal) {
      peakTotal = total;
      peakIdx = i;
    }
    months.push({ monthLabel: label, perCombo, total });
  }

  return {
    activePairs: 60 + Math.floor(rand() * 30),
    projectedNine: months.reduce((a, m) => a + m.total, 0),
    peakMonth: months[peakIdx]!.monthLabel,
    months,
  };
}

function arbRowByRegion(
  _f: Filters,
  combo: Combo,
  rand: () => number,
): ArbitrageRow {
  const quotes = REGION_COLUMNS.map((r) => ({
    region: r,
    price: Math.round(400 * regionMultiplier(r, rand) + rand() * 3000),
    n: 1 + Math.floor(rand() * 12),
  }));
  quotes.sort((a, b) => a.price - b.price);
  const low = quotes[0]!;
  const high = quotes[quotes.length - 1]!;
  const spreadAbs = high.price - low.price;
  const spreadPct = low.price === 0 ? 0 : (spreadAbs / low.price) * 100;
  return {
    combo,
    low: { label: low.region, tag: "buy", price: low.price, n: low.n },
    high: { label: high.region, tag: "sell", price: high.price, n: high.n },
    spreadAbs,
    spreadPct,
    attribution: synthesizeAttribution(_f, rand, 3, 48),
  };
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

