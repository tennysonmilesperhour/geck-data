// Data shapes for the /market widgets. Previously these lived alongside
// the fixture generators in src/lib/market/fixtures.ts; pulling them
// out so the dashboard can render real-data and empty states without
// any synthetic-data code in the bundle.
import type { Attribution, SourceId } from "./types";

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

export type IndexPoint = { t: string; v: number };

export type MarketIndex = {
  value: number;
  deltaPct: number;
  series: IndexPoint[];
  attribution: Attribution;
};

export const SUB_INDEX_MORPHS = [
  "Lilly White",
  "Harlequin",
  "Axanthic",
  "Cappuccino",
] as const;
export type SubIndexMorph = (typeof SUB_INDEX_MORPHS)[number];

export type MarketSubIndex = {
  morph: SubIndexMorph;
  value: number;
  deltaPct: number;
  series: IndexPoint[];
  attribution: Attribution;
};

export type Mover = {
  combo: Combo;
  avgPrice: number;
  n: number;
  deltaPct: number;
  spark: number[];
  attribution: Attribution;
};

export type CalendarEntry = {
  label: string;
  region: string;
  date: string;
  kind: "expo" | "release";
};

export type PeakTier = "Peaking" | "Fair value" | "Accumulate";

export type PeakIndicator = {
  combo: Combo;
  score: number;
  tier: PeakTier;
  action: string;
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

export type ComboRow = {
  combo: Combo;
  traits: [string, string];
  medianSold: number;
  stddev: number;
  ask: number;
  spreadPct: number;
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

export function sortComboRows(
  rows: ComboRow[],
  sort: ComboRankSort,
): ComboRow[] {
  const keyFn: Record<ComboRankSort, (r: ComboRow) => number> = {
    volume: (r) => r.volume,
    medianSold: (r) => r.medianSold,
    ask: (r) => r.ask,
    spread: (r) => Math.abs(r.spreadPct),
    days: (r) => -r.daysToSell,
  };
  return [...rows].sort((a, b) => keyFn[sort](b) - keyFn[sort](a));
}

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
  blend: Array<{
    source: SourceId;
    n: number;
    amount: number;
    pct: number;
    label: string;
  }>;
  keyMetrics: {
    medianAsk: number;
    askSoldSpreadPct: number;
    daysToSell: number;
    volume: number;
  };
  attribution: Attribution;
};

export const REGION_COLUMNS = [
  "US",
  "EU",
  "UK",
  "CA",
  "AU",
  "JP",
  "SE",
  "SEA",
] as const;
export type RegionKey = (typeof REGION_COLUMNS)[number];

export type HeatmapMetric = "medianSold" | "ask" | "spread";

export type HeatmapCell = {
  value: number;
  confidence: number;
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
    opportunities: number;
  };
};

export type SupplyMonth = {
  monthLabel: string;
  perCombo: Array<{ combo: Combo; n: number; color: string }>;
  total: number;
};

export type SupplyPipeline = {
  activePairs: number;
  projectedNine: number;
  peakMonth: string;
  months: SupplyMonth[];
};

export type BreederRow = {
  name: string;
  region: RegionKey;
  activeListings: number;
  soldInWindow: number;
  avgSoldPrice: number;
  avgDaysToSell: number;
  specialty: Combo;
  velocity: number[];
  lineageScore: number;
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
