// Data shapes for the /market widgets. Previously these lived alongside
// the fixture generators in src/lib/market/fixtures.ts; pulling them
// out so the dashboard can render real-data and empty states without
// any synthetic-data code in the bundle.
//
// The combo list itself now lives in lib/market/combos.ts (single source
// of truth, also consumed by /api/data/market.json). We re-derive the
// display-string union here for backward compatibility with widgets that
// already type their `combo` field as a literal union.
import type { Attribution, SourceId } from "./types";
import { HIGH_VALUE_COMBOS } from "./combos";

export const COMBOS = HIGH_VALUE_COMBOS.map((c) => c.display) as ReadonlyArray<string>;
// Combo is a wider `string` type now — the dashboard widgets only use it as
// a label key, never as an exhaustive switch.
export type Combo = string;

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

// One combo's move between two observed days of the asking-price index. Both
// endpoints travel with the row because the move is only as good as its
// thinner side, and because the current index usually rests on far fewer
// listings than the baseline (the live catalogue shrank between the two
// dates). A panel that shows only the percentage hides that.
export type Mover = {
  combo: Combo;
  /** Index value on the later day. */
  avgPrice: number;
  /** Listings behind the later day. */
  n: number;
  deltaPct: number;
  /** The two endpoints, in order. Nothing is observed between them. */
  spark: number[];
  /** Index value on the earlier day. */
  fromValue: number;
  /** Listings behind the earlier day. */
  fromN: number;
  fromDay: string | null;
  toDay: string | null;
  attribution: Attribution;
};

export type CalendarEntry = {
  label: string;
  region: string;
  date: string;
  kind: "expo" | "release";
};

// Evidence labels, not trading advice. These used to read "Peaking" / "Fair
// value" / "Accumulate" with actions "Sell into strength" / "Hold" /
// "Accumulate", which told a breeder what to DO with their animals off a
// composite score built from as few as two listings. The score describes
// where current asking prices sit against that combo's own recent range, and
// nothing more, so the labels now say only that.
export type PeakTier = "Above recent range" | "Within recent range" | "Below recent range";

export type PeakIndicator = {
  combo: Combo;
  score: number;
  tier: PeakTier;
  action: string;
  n: number;
  attribution: Attribution;
};

export function tierForScore(score: number): PeakTier {
  if (score >= 70) return "Above recent range";
  if (score >= 35) return "Within recent range";
  return "Below recent range";
}

// Minimum observations before any characterisation is offered at all. Below
// this the honest output is that we cannot say.
export const MIN_ACTION_OBSERVATIONS = 8;

/**
 * Describes what was observed. `n` is the number of observations behind the
 * score; pass it so a thin sample suppresses the phrasing entirely rather
 * than dressing two listings up as a market signal.
 */
export function actionForScore(score: number, n?: number): string {
  if (n != null && n < MIN_ACTION_OBSERVATIONS) {
    return "Too few observations to characterise";
  }
  if (score >= 70) return "Asking prices above this combo's recent range";
  if (score >= 35) return "Asking prices within this combo's recent range";
  return "Asking prices below this combo's recent range";
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
  /** Recent daily medians for this combo (oldest first), sourced from
   *  combo_index_daily. Empty if the MV is empty or the combo has no
   *  observations in the lookback window. */
  spark?: number[];
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

// Nullable where the warehouse does not measure the field. These used to be
// non-nullable, and queries.ts carried a ComboDetailLive alias that widened
// them one Omit at a time; the alias existed only because this type had not
// caught up. A metric nobody measured is null here, never a default, because
// a zero-filled price renders as "$0" and a reader cannot tell that from an
// observation.
export type ComboDetail = {
  combo: Combo;
  /** Each source's average price, weighted by that source's share of the
   *  observations. A mean of means. This was called `medianSold` until the
   *  2026-08-29 audit, which is a different statistic and a different word. */
  meanBlendedPrice: number | null;
  /** Observed low and high. Null because nothing computes them: the blend RPC
   *  returns no extremes, and the old value was a hardcoded [0, 0] that the
   *  panel rendered as a real $0 to $0 range. */
  range: [number, number] | null;
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
    /** All three are null for the same reason: the detail fetch reads a source
     *  blend, which carries no ask, no spread and no time-to-sell for a single
     *  combo. They were hardcoded zeros. */
    medianAsk: number | null;
    askSoldSpreadPct: number | null;
    daysToSell: number | null;
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
  /** Stable id (seller_id) for routing to /sellers/[id]. Optional so older
   *  call sites that pre-date this field still type-check while the data
   *  source catches up. */
  id?: string;
  name: string;
  /** Marketplace store profile image captured from the seller page. */
  avatarUrl: string | null;
  /** Null when the seller's location string could not be mapped, which is most
   *  of them: about 85% of listings carry no location at all. It used to
   *  default to "US", which then fed the "Top region" KPI, so the dashboard
   *  reported a US-dominated market that was really an unparsed one. */
  region: RegionKey | null;
  activeListings: number;
  soldInWindow: number;
  /** Mean of that seller's sold prices. Null when none of their sold listings
   *  carried one: it used to fall back to `market_sellers.avg_price`, which is
   *  an average asking price printed under a "sold" heading. */
  avgSoldPrice: number | null;
  /** Mean days from first seen to sold across sold events in the window. Null
   *  when the seller has none, which is nearly every seller today. */
  avgDaysToSell: number | null;
  specialty: Combo;
  velocity: number[];
  /** Null when the seller row carries none of the score's inputs. Not a
   *  lineage measurement either way, see the comment at the call site. */
  lineageScore: number | null;
  attribution: Attribution;
};

export type BreedersData = {
  rows: BreederRow[];
  kpis: {
    totalBreeders: number;
    /** Null when no seller's location could be mapped at all. */
    topRegion: RegionKey | null;
    /** How many of the listed breeders had a location we could map, so the KPI
     *  can say what it is a top region OF. */
    regionMapped: number;
    avgSoldPrice: number | null;
    avgDaysToSell: number | null;
  };
};

// One seller's slice of the tracked live catalogue, for the concentration
// bar chart. `sharePct` is a share of the ATTRIBUTED pool (listings that
// carry an identified seller), never of the whole catalogue, because
// MorphMarket hides the seller on ~88% of public listings.
export type BreederShareRow = {
  id: string;
  name: string;
  listings: number;
  sharePct: number;
};

export type BreederConcentration = {
  /** Top sellers by tracked-listing count, most first. */
  rows: BreederShareRow[];
  /** Denominator for every sharePct: live listings that carry a seller. */
  totalAttributed: number;
  /** Distinct sellers behind those attributed listings. */
  sellerCount: number;
  /** attributed / all live listings, as a percent. The honesty caveat: this
   *  concentration is measured over only this slice of the catalogue. */
  coveragePct: number;
  /** Combined share of the top ten sellers, within the attributed pool. */
  top10Pct: number;
  attribution: Attribution;
};
