// Real-data fetchers for every /market widget. Each fetcher wraps a
// Supabase query and returns a `QueryResult<T | null>`:
//
//   - `live: true`: rows came from Supabase
//   - `live: false`, data: null: no data yet (DB empty, view missing,
//     RLS denied, or the feature genuinely is not wired up). Widgets
//     render an empty state, never synthetic numbers.
//
// `attributionNote` carries either a one-line provenance string for
// live results ("v_combo_rollups(90d)") or the reason an empty state
// is showing ("v_market_sub_index not implemented").
//
// Second rule, added after the 2026-08-29 data audit: a metric the
// warehouse did not measure comes back as null, never as a default. A
// zero-filled price renders as "$0" and a defaulted duration renders as
// "30 d", and a reader cannot tell either of those from something we
// actually observed. Several fields are nullable here as a result, which
// widens the shapes in widget-types.ts; the `*Live` aliases below name
// which ones and say why.
"use client";
import { createClient } from "@/lib/supabase/client";
import type { Filters, SourceId } from "./types";
import {
  REGION_COLUMNS,
  type Arbitrage,
  type ArbitrageAxis,
  type BreedersData,
  type ComboDetail,
  type ComboRankSort,
  type ComboRow,
  type HeatmapCell,
  type HeatmapMetric,
  type MarketIndex,
  type MarketSubIndex,
  type Mover,
  type PeakIndicator,
  type RegionKey,
  type RegionalHeatmap,
  type SupplyMonth,
  type SupplyPipeline,
} from "./widget-types";
import { normalizeSourceId, sourceMeta } from "./sources";

export type QueryResult<T> = {
  data: T;
  live: boolean;
  fetchedAt: string;
  attributionNote?: string;
};

function ok<T>(data: T, note?: string): QueryResult<T> {
  return {
    data,
    live: true,
    fetchedAt: new Date().toISOString(),
    attributionNote: note,
  };
}

function empty<T>(data: T, reason: string): QueryResult<T> {
  return {
    data,
    live: false,
    fetchedAt: new Date().toISOString(),
    attributionNote: reason,
  };
}

const DAYS_BY_TIMEFRAME: Record<string, number> = {
  "30d": 30,
  "90d": 90,
  "6mo": 180,
  "12mo": 365,
  "24mo": 730,
};

function windowDays(filters: Filters): number {
  return DAYS_BY_TIMEFRAME[filters.timeframe] ?? 365;
}

function confidenceSources(filters: Filters): SourceId[] {
  return filters.sources === "all"
    ? ["gi_sales", "gi_listings"]
    : Array.from(filters.sources);
}

// Postgres numerics arrive as strings through PostgREST, and any of them can
// be null. Parsing is centralised so no call site reaches for `?? 0`: a price
// we never observed is not zero dollars, and a duration we never observed is
// not zero days.
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundOrNull(v: number | null): number | null {
  return v == null ? null : Math.round(v);
}

// Confidence means one thing across this file: how many observations sit
// behind the number on screen. Every fetcher used to carry its own formula
// (20 + n * 2 here, 20 + min(40, n) there, a SQL score with a floor of 20 in
// v_combo_rollups), so the same 0..100 chip meant three different things and
// none of them matched the rubric /methodology publishes. One curve instead:
//
//   score = 100 * log10(n) / log10(SATURATION), and 0 when n <= 0
//
// Every doubling of the sample is worth the same fixed step, a single
// observation earns nothing, and past SATURATION more rows stop changing what
// we are willing to say. It is a sample-size statement and nothing else: it
// says nothing about how fresh those observations are, which is what the
// stale-data banner is for.
const CONFIDENCE_SATURATION_N = 200;

function sampleConfidence(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const capped = Math.min(n, CONFIDENCE_SATURATION_N);
  return Math.round(
    (Math.log10(capped) / Math.log10(CONFIDENCE_SATURATION_N)) * 100,
  );
}

// ----------------------------------------------------------------------------
// Market Index: v_market_index(window_days) + delta vs period start
// ----------------------------------------------------------------------------
export async function fetchMarketIndex(
  filters: Filters,
): Promise<QueryResult<MarketIndex | null>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("v_market_index", {
      window_days: windowDays(filters),
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      week_start: string;
      value: number | string;
      combos_in: number;
    }>;
    if (rows.length < 2) {
      return empty(null, "v_market_index returned <2 rows");
    }
    const series = rows.map((r) => ({
      t: r.week_start.slice(0, 7),
      v: Math.round(Number(r.value)),
    }));
    const value = series[series.length - 1]!.v;
    const start = series[0]!.v;
    const deltaPct = start === 0 ? 0 : ((value - start) / start) * 100;
    const n = rows.reduce((a, r) => a + (r.combos_in ?? 0), 0);
    return ok<MarketIndex>(
      {
        value,
        deltaPct,
        series,
        attribution: {
          sources: confidenceSources(filters),
          confidence: { score: sampleConfidence(n) },
        },
      },
      `v_market_index(${windowDays(filters)}d, ${rows.length} weeks)`,
    );
  } catch (e) {
    return empty(null, `fetchMarketIndex error: ${errMsg(e)}`);
  }
}

// ----------------------------------------------------------------------------
// Market Sub-Indices: v_market_sub_index(window_days), 0035
// ----------------------------------------------------------------------------
type SubIndexRow = {
  anchor: string;
  week_start: string;
  value: number | string | null;
  median_price: number | string | null;
  n: number | string;
};

export async function fetchMarketSubIndices(
  filters: Filters,
): Promise<QueryResult<MarketSubIndex[] | null>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("v_market_sub_index", {
      window_days: windowDays(filters),
    });
    if (error) throw error;
    const rows = (data ?? []) as SubIndexRow[];
    if (rows.length === 0) {
      return empty(null, "v_market_sub_index returned no rows");
    }
    const byAnchor = new Map<string, MarketSubIndex>();
    const seriesAcc = new Map<string, Array<{ t: string; v: number }>>();
    const nAcc = new Map<string, number>();
    for (const r of rows) {
      if (r.value == null) continue;
      const v = Math.round(Number(r.value));
      const seriesRow = { t: r.week_start.slice(0, 7), v };
      const arr = seriesAcc.get(r.anchor) ?? [];
      arr.push(seriesRow);
      seriesAcc.set(r.anchor, arr);
      nAcc.set(r.anchor, (nAcc.get(r.anchor) ?? 0) + Number(r.n ?? 0));
    }
    const ALLOWED: ReadonlyArray<MarketSubIndex["morph"]> = [
      "Lilly White",
      "Harlequin",
      "Axanthic",
      "Cappuccino",
    ];
    for (const [anchor, series] of seriesAcc) {
      if (series.length < 2) continue;
      if (!ALLOWED.includes(anchor as MarketSubIndex["morph"])) continue;
      const value = series[series.length - 1]!.v;
      const start = series[0]!.v;
      const deltaPct = start === 0 ? 0 : ((value - start) / start) * 100;
      byAnchor.set(anchor, {
        morph: anchor as MarketSubIndex["morph"],
        value,
        deltaPct,
        series,
        attribution: {
          sources: confidenceSources(filters),
          confidence: { score: sampleConfidence(nAcc.get(anchor) ?? 0) },
        },
      });
    }
    const out = Array.from(byAnchor.values());
    if (out.length === 0) return empty(null, "no anchors with enough weeks");
    out.sort(
      (a, b) =>
        ALLOWED.indexOf(a.morph) - ALLOWED.indexOf(b.morph),
    );
    return ok(out, `v_market_sub_index(${windowDays(filters)}d)`);
  } catch (e) {
    return empty(null, `fetchMarketSubIndices error: ${errMsg(e)}`);
  }
}

// ----------------------------------------------------------------------------
// Combos ranked: v_combo_rollups(window_days)
// ----------------------------------------------------------------------------
type RollupRow = {
  combo_name: string;
  sold_count: number;
  live_count: number;
  median_sold: number | null;
  median_ask: number | null;
  spread_pct: number | null;
  avg_days_to_sell: number | null;
  confidence_score: number;
};

async function fetchRollups(filters: Filters): Promise<{
  rows: RollupRow[];
  live: boolean;
  reason?: string;
}> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("v_combo_rollups", {
      window_days: windowDays(filters),
    });
    if (error) throw error;
    const rows = (data ?? []) as RollupRow[];
    const usable = rows.filter((r) => r.sold_count > 0 || r.live_count > 0);
    if (usable.length === 0) {
      return { rows: [], live: false, reason: "no combos with observations" };
    }
    return { rows: usable, live: true };
  } catch (e) {
    return { rows: [], live: false, reason: errMsg(e) };
  }
}

// A ranked row where every metric the rollup can fail to measure is
// nullable, so the table prints a dash instead of a number nobody observed.
// `stddev` is dropped rather than nulled: it was `medianSold * 0.15`, and no
// query in this codebase measures dispersion, so there is nothing to put back
// until a real p25/p75 source lands.
//
// This widens widget-types' ComboRow locally. Once that type carries the same
// nullability, this alias collapses to `ComboRow` and can be deleted.
export type RankedComboRow = Omit<
  ComboRow,
  "stddev" | "medianSold" | "ask" | "spreadPct" | "daysToSell"
> & {
  /** Median sold price in the window. Null while the combo has no sold rows,
   *  which is every combo at 90d today. */
  medianSold: number | null;
  /** Median live asking price. Null when nothing is listed. */
  ask: number | null;
  /** Ask over sold, in percent. Needs both sides, so it follows medianSold. */
  spreadPct: number | null;
  /** Mean days from first seen to sold. Null when no sold event carried one,
   *  rather than the old default of 30, which was indistinguishable from a
   *  measured month. */
  daysToSell: number | null;
};

// sortComboRows() in widget-types keys on plain numbers, so a null would sort
// as if it were zero: cheapest on a price sort, fastest on a days-to-sell
// sort. Unmeasured rows go to the bottom in every direction instead, so the
// top of the table is always rows we have data for.
function sortRankedRows(
  rows: RankedComboRow[],
  sort: ComboRankSort,
): RankedComboRow[] {
  const keyFn: Record<ComboRankSort, (r: RankedComboRow) => number | null> = {
    volume: (r) => r.volume,
    medianSold: (r) => r.medianSold,
    ask: (r) => r.ask,
    spread: (r) => (r.spreadPct == null ? null : Math.abs(r.spreadPct)),
    days: (r) => (r.daysToSell == null ? null : -r.daysToSell),
  };
  return [...rows].sort((a, b) => {
    const av = keyFn[sort](a);
    const bv = keyFn[sort](b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
}

export async function fetchCombosRanked(
  filters: Filters,
  sort: ComboRankSort,
): Promise<QueryResult<RankedComboRow[] | null>> {
  const { rows, live, reason } = await fetchRollups(filters);
  if (!live) return empty(null, reason ?? "no data");

  // In parallel with the rollup, pull the recent daily medians so each
  // row can render a 60-day sparkline. The MV combo_index_daily is
  // bounded to 365 days; we slice to the most recent 60 client-side.
  // Failure here is non-fatal: rows render without sparklines.
  const supabase = createClient();
  const sparkByCombo = new Map<string, number[]>();
  try {
    const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
    const { data: sparkRows } = await supabase
      .from("combo_index_daily")
      .select("combo_id, day, median_price")
      .gte("day", cutoff)
      .order("day", { ascending: true })
      .limit(5000);
    // Cross-walk combo_id (canonical short id) -> combo_name (display
    // name) so we can key the sparkline by the same string the rollup
    // uses.
    const { HIGH_VALUE_COMBOS } = await import("@/lib/market/combos");
    const idToDisplay = new Map(
      HIGH_VALUE_COMBOS.map((c) => [c.id, c.display]),
    );
    for (const r of (sparkRows ?? []) as Array<{
      combo_id: string;
      median_price: number | string | null;
    }>) {
      if (r.median_price == null) continue;
      const v = Number(r.median_price);
      if (!Number.isFinite(v)) continue;
      const display = idToDisplay.get(r.combo_id) ?? r.combo_id;
      const arr = sparkByCombo.get(display) ?? [];
      arr.push(v);
      sparkByCombo.set(display, arr);
    }
  } catch {
    // Non-fatal; rows just render without sparklines.
  }

  const mapped: RankedComboRow[] = rows.map((r) => {
    const parts = r.combo_name.split(" × ");
    // Nothing is substituted for anything else here. `ask` used to fall back
    // to the sold median, which put an asking price under a "sold" heading
    // whenever the combo had no live listings.
    return {
      combo: r.combo_name as ComboRow["combo"],
      traits: [parts[0] ?? r.combo_name, parts[1] ?? ""],
      medianSold: roundOrNull(num(r.median_sold)),
      ask: roundOrNull(num(r.median_ask)),
      spreadPct: num(r.spread_pct),
      daysToSell: roundOrNull(num(r.avg_days_to_sell)),
      volume: r.sold_count,
      attribution: {
        sources: confidenceSources(filters),
        // Recomputed from the observation count rather than passing through
        // the rollup's confidence_score, which starts at 20 for a combo with
        // nothing behind it at all.
        confidence: { score: sampleConfidence(r.sold_count + r.live_count) },
      },
      spark: sparkByCombo.get(r.combo_name) ?? [],
    };
  });
  return ok(
    sortRankedRows(mapped, sort),
    `v_combo_rollups(${windowDays(filters)}d), ${mapped.length} combos`,
  );
}

// ----------------------------------------------------------------------------
// Top Movers: suppressed until there is a disjoint window to compare with.
// ----------------------------------------------------------------------------
// A mover claims a price changed between two periods, so the two periods have
// to be different periods. This read v_combo_rollups(w) against
// v_combo_rollups(2w), and 2w contains w, so every delta was damped toward
// zero by construction: a combo that doubled inside w was compared against a
// baseline that already included the doubling.
//
// The RPC only accepts a trailing window from now(), and a median cannot be
// un-mixed from a longer window's median, so the preceding window cannot be
// derived here either. Until the warehouse exposes a lagged window, the honest
// output is the empty state plus the reason for it.
export async function fetchTopMovers(
  filters: Filters,
): Promise<
  QueryResult<{ appreciating: Mover[]; depreciating: Mover[] } | null>
> {
  try {
    const supabase = createClient();
    const w = windowDays(filters);
    const { data, error } = await supabase.rpc("v_combo_rollups", {
      window_days: w,
    });
    if (error) throw error;
    const rows = (data ?? []) as RollupRow[];
    if (rows.length === 0) {
      return empty(null, "no combos with observations");
    }
    // Today's state: sold_count is 0 for every combo at 90d, so there is no
    // sold price on either side of the comparison to move.
    const soldTotal = rows.reduce((a, r) => a + (r.sold_count ?? 0), 0);
    if (soldTotal === 0) {
      return empty(null, `no sold observations in the last ${w}d`);
    }
    return empty(
      null,
      `no preceding ${w}d window to compare against: v_combo_rollups only takes a trailing window`,
    );
  } catch (e) {
    return empty(null, `fetchTopMovers error: ${errMsg(e)}`);
  }
}

// ----------------------------------------------------------------------------
// Peak Indicator: suppressed for the same reason as movers.
// ----------------------------------------------------------------------------
// The old score was 35 plus a volume term plus a momentum term plus a spread
// term, clamped to 5..95. Two of those three inputs are unavailable: sold
// volume is zero for every combo, and the momentum term came from the same
// w-inside-2w comparison the movers used. What survived was the constant 35
// and a usually-null spread, presented as a read on the market.
//
// A real version needs the combo's own recent range (p25/p75 from a daily or
// weekly index), which is what the tier labels in widget-types now describe,
// plus sold volume on both sides of a disjoint comparison.
export async function fetchPeakIndicators(
  filters: Filters,
): Promise<QueryResult<PeakIndicator[] | null>> {
  try {
    const supabase = createClient();
    const w = windowDays(filters);
    const { data, error } = await supabase.rpc("v_combo_rollups", {
      window_days: w,
    });
    if (error) throw error;
    const rows = (data ?? []) as RollupRow[];
    if (rows.length === 0) {
      return empty(null, "no combos with observations");
    }
    const soldTotal = rows.reduce((a, r) => a + (r.sold_count ?? 0), 0);
    if (soldTotal === 0) {
      return empty(null, `no sold observations in the last ${w}d`);
    }
    return empty(
      null,
      `no preceding ${w}d window to score momentum against: v_combo_rollups only takes a trailing window`,
    );
  } catch (e) {
    return empty(null, `fetchPeakIndicators error: ${errMsg(e)}`);
  }
}

// ----------------------------------------------------------------------------
// Combo detail: v_combo_source_blend
// ----------------------------------------------------------------------------
// The detail panel's shape, with the three statistics nobody measured turned
// into nulls and the mean renamed to a mean. Widens ComboDetail locally; the
// alias collapses once widget-types carries the same fields.
export type ComboDetailLive = Omit<
  ComboDetail,
  "medianSold" | "range" | "keyMetrics"
> & {
  /** Each source's average price, weighted by that source's share of the
   *  observations. A mean of means. It was returned as `medianSold` until the
   *  2026-08-29 audit, which is a different statistic and a different word. */
  meanBlendedPrice: number | null;
  /** Observed low and high. Null because nothing here computes them: the blend
   *  RPC returns no extremes, and the old value was a hardcoded [0, 0] that
   *  the panel rendered as a real $0 to $0 range. */
  range: [number, number] | null;
  keyMetrics: {
    /** All three are null for the same reason: this fetch reads a source blend,
     *  which carries no ask, no spread and no time-to-sell for one combo. They
     *  were hardcoded zeros. */
    medianAsk: number | null;
    askSoldSpreadPct: number | null;
    daysToSell: number | null;
    volume: number;
  };
};

export async function fetchComboDetail(
  filters: Filters,
  combo: string | null,
): Promise<QueryResult<ComboDetailLive | null>> {
  if (!combo) {
    return ok(null);
  }
  try {
    const supabase = createClient();
    const w = windowDays(filters);
    const [blend, series] = await Promise.all([
      supabase.rpc("v_combo_source_blend", { p_combo: combo, window_days: w }),
      supabase
        .from("price_history")
        .select(
          "observed_at, price_usd_equivalent, source, listing_id!inner(cached_traits, norm_traits)",
        )
        .gte("observed_at", new Date(Date.now() - w * 86400_000).toISOString())
        .not("price_usd_equivalent", "is", null)
        .limit(2000),
    ]);
    if (blend.error) throw blend.error;
    if (series.error) throw series.error;
    const blendRows = ((blend.data ?? []) as Array<{
      source: string;
      n: number;
      avg_price: number | string;
      pct: number | string;
    }>).filter((b) => b.n > 0);
    if (blendRows.length === 0) {
      return empty(null, "no blend rows for combo");
    }
    const observations = blendRows.reduce((a, b) => a + b.n, 0);
    // `pct` is each source's share of the observations. Divide by the shares
    // that survived the n > 0 filter above rather than by a hardcoded 100,
    // otherwise dropping a source quietly deflates the average.
    let weighted = 0;
    let totalPct = 0;
    for (const b of blendRows) {
      const px = num(b.avg_price);
      const pct = num(b.pct);
      if (px == null || pct == null) continue;
      weighted += px * pct;
      totalPct += pct;
    }
    return ok<ComboDetailLive>(
      {
        combo: combo as ComboDetail["combo"],
        meanBlendedPrice: totalPct > 0 ? Math.round(weighted / totalPct) : null,
        range: null,
        observations,
        // There is still no per-combo multi-series pipeline, so the chart data
        // stays empty on purpose and ComboDetailPanel shows its "chart not
        // wired" placeholder instead of a line drawn from one blended number.
        series: [],
        blend: blendRows.map((b) => {
          const id = normalizeSourceId(b.source);
          return {
            source: id,
            n: b.n,
            amount: Math.round(Number(b.avg_price)),
            pct: Math.round(Number(b.pct)),
            label:
              b.source && b.source !== id
                ? `${sourceMeta(id).short} (${b.source})`
                : sourceMeta(id).short,
          };
        }),
        keyMetrics: {
          medianAsk: null,
          askSoldSpreadPct: null,
          daysToSell: null,
          volume: observations,
        },
        attribution: {
          sources: confidenceSources(filters),
          confidence: { score: sampleConfidence(observations) },
        },
      },
      `v_combo_source_blend(${combo}, ${w}d), ${observations} observations`,
    );
  } catch (e) {
    return empty(null, `fetchComboDetail error: ${errMsg(e)}`);
  }
}

// ----------------------------------------------------------------------------
// Regional heatmap: v_regional_heatmap(window_days)
// ----------------------------------------------------------------------------
export async function fetchRegionalHeatmap(
  filters: Filters,
  metric: HeatmapMetric,
): Promise<QueryResult<RegionalHeatmap | null>> {
  try {
    const supabase = createClient();
    const w = windowDays(filters);
    const { data, error } = await supabase.rpc("v_regional_heatmap", {
      window_days: w,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      combo_name: string;
      region: RegionKey;
      n: number;
      median_sold: number | string | null;
      median_ask: number | string | null;
      confidence_score: number;
    }>;
    if (rows.length === 0) {
      return empty(null, "no regional observations");
    }
    const byCombo = new Map<string, Map<RegionKey, (typeof rows)[number]>>();
    for (const r of rows) {
      let m = byCombo.get(r.combo_name);
      if (!m) {
        m = new Map();
        byCombo.set(r.combo_name, m);
      }
      m.set(r.region, r);
    }
    let lo = Infinity;
    let hi = -Infinity;
    const built = Array.from(byCombo.entries()).map(([combo, regions]) => {
      const cells: Record<RegionKey, HeatmapCell> = {
        US: null, EU: null, UK: null, CA: null,
        AU: null, JP: null, SE: null, SEA: null,
      };
      for (const region of REGION_COLUMNS) {
        const row = regions.get(region);
        if (!row) continue;
        const value = pickMetric(row, metric);
        if (value == null) continue;
        const v = Math.round(Number(value));
        cells[region] = {
          // 0..1 for the cell's opacity. Floored at 0.18 so a thin cell is
          // still readable, and driven by the cell's own observation count
          // rather than the view's confidence_score, which floors at 20.
          confidence: Math.max(0.18, sampleConfidence(row.n) / 100),
          value: v,
          n: row.n,
        };
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return { combo: combo as RegionalHeatmap["rows"][number]["combo"], cells };
    });
    if (!Number.isFinite(lo)) {
      return empty(null, "no cells resolved in pivot");
    }
    return ok<RegionalHeatmap>(
      {
        metric,
        rows: built,
        range: [lo, hi],
        attribution: {
          sources: confidenceSources(filters),
          confidence: {
            score: sampleConfidence(rows.reduce((a, r) => a + r.n, 0)),
          },
        },
      },
      `v_regional_heatmap(${w}d)`,
    );
  } catch (e) {
    return empty(null, `fetchRegionalHeatmap error: ${errMsg(e)}`);
  }
}

function pickMetric(
  row: { median_sold: number | string | null; median_ask: number | string | null },
  metric: HeatmapMetric,
): number | null {
  if (metric === "medianSold") return row.median_sold ? Number(row.median_sold) : null;
  if (metric === "ask") return row.median_ask ? Number(row.median_ask) : null;
  if (!row.median_sold || !row.median_ask) return null;
  const s = Number(row.median_sold);
  const a = Number(row.median_ask);
  return s === 0 ? 0 : ((a - s) / s) * 100;
}

// ----------------------------------------------------------------------------
// Arbitrage: derived from v_regional_heatmap (axis='region'). The
// 'source' axis returns an empty state until we have real multi-source
// price data; it used to return fixture data unconditionally.
// ----------------------------------------------------------------------------
export async function fetchArbitrage(
  filters: Filters,
  axis: ArbitrageAxis,
): Promise<QueryResult<Arbitrage | null>> {
  if (axis === "source") {
    return empty(null, "source axis needs multi-source price data");
  }
  try {
    const supabase = createClient();
    const w = windowDays(filters);
    const { data, error } = await supabase.rpc("v_regional_heatmap", {
      window_days: w,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      combo_name: string;
      region: RegionKey;
      n: number;
      median_sold: number | string | null;
      median_ask: number | string | null;
      confidence_score: number;
    }>;
    if (rows.length === 0) {
      return empty(null, "no regional rows");
    }
    const byCombo = new Map<string, (typeof rows)[number][]>();
    for (const r of rows) {
      if (!r.median_sold) continue;
      const arr = byCombo.get(r.combo_name) ?? [];
      arr.push(r);
      byCombo.set(r.combo_name, arr);
    }
    const outRows = Array.from(byCombo.entries())
      .map(([combo, rs]) => {
        const sorted = [...rs].sort(
          (a, b) => Number(a.median_sold) - Number(b.median_sold),
        );
        const low = sorted[0]!;
        const high = sorted[sorted.length - 1]!;
        const lowPx = Number(low.median_sold);
        const highPx = Number(high.median_sold);
        const spreadAbs = highPx - lowPx;
        const spreadPct = lowPx === 0 ? 0 : (spreadAbs / lowPx) * 100;
        return {
          combo: combo as Arbitrage["rows"][number]["combo"],
          low: { label: low.region, tag: "buy", price: Math.round(lowPx), n: low.n },
          high: {
            label: high.region,
            tag: "sell",
            price: Math.round(highPx),
            n: high.n,
          },
          spreadAbs: Math.round(spreadAbs),
          spreadPct,
          attribution: {
            sources: confidenceSources(filters),
            // A spread is only as good as its thinner side.
            confidence: { score: sampleConfidence(Math.min(low.n, high.n)) },
          },
        };
      })
      .filter((r) => r.spreadAbs > 0)
      .sort((a, b) => b.spreadPct - a.spreadPct);
    if (outRows.length === 0) {
      return empty(null, "no non-zero spreads");
    }
    const pcts = outRows.map((r) => r.spreadPct);
    return ok<Arbitrage>(
      {
        axis,
        rows: outRows.slice(0, 10),
        kpis: {
          biggestPct: pcts[0] ?? 0,
          avgPct: pcts.reduce((a, b) => a + b, 0) / pcts.length,
          opportunities: pcts.filter((p) => p >= 10).length,
        },
      },
      `v_regional_heatmap(${w}d) spread`,
    );
  } catch (e) {
    return empty(null, `fetchArbitrage error: ${errMsg(e)}`);
  }
}

// ----------------------------------------------------------------------------
// Supply pipeline: v_supply_pipeline_monthly (admin + owner visibility)
// ----------------------------------------------------------------------------
export async function fetchSupplyPipeline(
  filters: Filters,
): Promise<QueryResult<SupplyPipeline | null>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("v_supply_pipeline_monthly")
      .select("month_start, combo_name, projected_juveniles");
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      month_start: string;
      combo_name: string;
      projected_juveniles: number;
    }>;
    if (rows.length === 0) {
      return empty(null, "no breeding pairs / clutches yet");
    }
    const months = new Map<string, SupplyMonth>();
    const colorFor = supplyColor();
    for (const r of rows) {
      const label = new Date(r.month_start).toLocaleString("en-US", {
        month: "short",
        year: "2-digit",
      });
      let m = months.get(label);
      if (!m) {
        m = { monthLabel: label, perCombo: [], total: 0 };
        months.set(label, m);
      }
      m.perCombo.push({
        combo: r.combo_name as SupplyMonth["perCombo"][number]["combo"],
        n: r.projected_juveniles,
        color: colorFor(r.combo_name),
      });
      m.total += r.projected_juveniles;
    }
    const monthsArr = [...months.values()].sort((a, b) =>
      Date.parse(a.monthLabel) - Date.parse(b.monthLabel),
    );
    const peak = monthsArr.reduce(
      (acc, m) => (m.total > acc.total ? m : acc),
      monthsArr[0]!,
    );
    const { data: pairs } = await supabase
      .from("breeding_pairs")
      .select("id", { count: "exact", head: true })
      .eq("active", true);
    void filters;
    return ok<SupplyPipeline>(
      {
        activePairs: pairs ? (pairs as unknown as { count?: number }).count ?? 0 : 0,
        projectedNine: monthsArr.reduce((a, m) => a + m.total, 0),
        peakMonth: peak.monthLabel,
        months: monthsArr,
      },
      "v_supply_pipeline_monthly",
    );
  } catch (e) {
    return empty(null, `fetchSupplyPipeline error: ${errMsg(e)}`);
  }
}

function supplyColor(): (combo: string) => string {
  const palette = [
    "#2dbf95", "#60a5fa", "#a78bfa", "#f472b6", "#fbbf24", "#fb7185",
    "#22d3ee", "#c084fc", "#4ade80", "#fde047", "#f97316", "#38bdf8",
  ];
  const cache = new Map<string, string>();
  return (combo: string): string => {
    const hit = cache.get(combo);
    if (hit) return hit;
    const next = palette[cache.size % palette.length]!;
    cache.set(combo, next);
    return next;
  };
}

// ----------------------------------------------------------------------------
// Breeders: market_sellers + listing_status_events + seller_snapshots
// ----------------------------------------------------------------------------
// Breeder rows with the invented numbers turned into nulls. Widens the
// BreedersData shapes locally until widget-types carries the same fields.
export type BreederRowLive = Omit<
  BreedersData["rows"][number],
  "avgSoldPrice" | "avgDaysToSell" | "lineageScore"
> & {
  /** Mean of that seller's sold prices. Null when none of their sold listings
   *  carried one: it used to fall back to `market_sellers.avg_price`, which is
   *  an average asking price printed under a "sold" heading. */
  avgSoldPrice: number | null;
  /** Mean days from first seen to sold across sold events in the window. Null
   *  when the seller has none, which is nearly every seller today. */
  avgDaysToSell: number | null;
  /** Null when the seller row carries none of the score's inputs. Not a
   *  lineage measurement either way, see the comment at the call site. */
  lineageScore: number | null;
};

export type BreedersDataLive = {
  rows: BreederRowLive[];
  kpis: Omit<BreedersData["kpis"], "avgSoldPrice" | "avgDaysToSell"> & {
    avgSoldPrice: number | null;
    avgDaysToSell: number | null;
  };
};

export async function fetchBreeders(
  filters: Filters,
): Promise<QueryResult<BreedersDataLive | null>> {
  try {
    const supabase = createClient();
    const since = new Date(
      Date.now() - windowDays(filters) * 86400_000,
    ).toISOString();
    const { data: sellers, error } = await supabase
      .from("market_sellers")
      .select(
        "seller_id, seller_name, seller_location, total_listings, avg_price, feedback_count",
      )
      .order("total_listings", { ascending: false })
      .limit(60);
    if (error) throw error;
    const rows = (sellers ?? []) as Array<{
      seller_id: string;
      seller_name: string | null;
      seller_location: string | null;
      total_listings: number | null;
      avg_price: number | null;
      feedback_count: number | null;
    }>;
    if (rows.length === 0) {
      return empty(null, "no sellers in market_sellers");
    }
    const ids = rows.map((r) => r.seller_id);
    const [sold, statuses] = await Promise.all([
      supabase
        .from("market_listings")
        .select("seller_id, price_usd_equivalent, current_status")
        .in("seller_id", ids)
        .eq("current_status", "sold"),
      supabase
        .from("listing_status_events")
        .select(
          "listing_id, observed_at, days_since_first_seen, listing_id!inner(seller_id)",
        )
        .eq("status", "sold")
        .gte("observed_at", since)
        .limit(5000),
    ]);
    // `sold` is every listing currently marked sold, with no date filter:
    // market_listings has no sold timestamp this query can bound, so the count
    // is sold-to-date, not sold-in-window. The attribution note says so rather
    // than the label implying a window the query never applied.
    const soldBySeller = new Map<
      string,
      { sold: number; priced: number; sumPx: number }
    >();
    for (const r of (sold.data ?? []) as Array<{
      seller_id: string;
      price_usd_equivalent: number | null;
    }>) {
      const rec = soldBySeller.get(r.seller_id) ?? {
        sold: 0,
        priced: 0,
        sumPx: 0,
      };
      rec.sold += 1;
      // A sold listing with no price is not a $0 sale, so it stays out of the
      // average instead of dragging it toward zero.
      const px = num(r.price_usd_equivalent);
      if (px != null) {
        rec.priced += 1;
        rec.sumPx += px;
      }
      soldBySeller.set(r.seller_id, rec);
    }
    const daysBySeller = new Map<string, number[]>();
    for (const r of (statuses.data ?? []) as Array<{
      days_since_first_seen: number | null;
      listing_id: { seller_id: string } | null;
    }>) {
      const sid = r.listing_id?.seller_id;
      if (!sid || r.days_since_first_seen == null) continue;
      const arr = daysBySeller.get(sid) ?? [];
      arr.push(r.days_since_first_seen);
      daysBySeller.set(sid, arr);
    }
    const built: BreederRowLive[] = rows.slice(0, 12).map((s) => {
      const soldAgg = soldBySeller.get(s.seller_id);
      const daysArr = daysBySeller.get(s.seller_id) ?? [];
      const avgDays =
        daysArr.length === 0
          ? null
          : Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length);
      const region = (regionOfText(s.seller_location) ?? "US") as RegionKey;
      // The pill says lineage, but nothing in this pipeline observes lineage:
      // the inputs are listing count, average asking price and feedback count,
      // so it is a coverage weight wearing the wrong name. It is null when the
      // seller row carries none of the three, because the old
      // `|| 30 + (idx % 60)` fallback made the pill a function of the row's
      // position in a list sorted by listing count, which is not reputation.
      const hasScoreInputs =
        s.total_listings != null ||
        s.avg_price != null ||
        s.feedback_count != null;
      const lineageScore = hasScoreInputs
        ? Math.min(
            100,
            Math.round(
              25 +
                Math.min(40, (s.total_listings ?? 0) * 0.4) +
                Math.min(25, (s.avg_price ?? 0) / 200) +
                Math.min(10, (s.feedback_count ?? 0) * 0.02),
            ),
          )
        : null;
      return {
        id: s.seller_id,
        name: s.seller_name ?? s.seller_id,
        region,
        activeListings: Math.max(0, s.total_listings ?? 0),
        soldInWindow: soldAgg?.sold ?? 0,
        avgSoldPrice:
          soldAgg && soldAgg.priced > 0
            ? Math.round(soldAgg.sumPx / soldAgg.priced)
            : null,
        avgDaysToSell: avgDays,
        specialty: "—" as BreedersData["rows"][number]["specialty"],
        velocity: [],
        lineageScore,
        attribution: {
          sources: ["gi_listings"] as SourceId[],
          confidence: { score: sampleConfidence(soldAgg?.sold ?? 0) },
        },
      };
    });
    const byRegion = new Map<RegionKey, number>();
    for (const r of built) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + 1);
    const topRegion = ([...byRegion.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      "US") as RegionKey;
    // Both KPI averages skip the rows that have no value instead of counting
    // them as zero, and go null when no row has one at all.
    const soldPrices = built
      .map((r) => r.avgSoldPrice)
      .filter((v): v is number => v != null);
    const dayValues = built
      .map((r) => r.avgDaysToSell)
      .filter((v): v is number => v != null);
    const avgPx =
      soldPrices.length === 0
        ? null
        : Math.round(
            soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length,
          );
    const avgDays =
      dayValues.length === 0
        ? null
        : Math.round(dayValues.reduce((a, b) => a + b, 0) / dayValues.length);
    return ok<BreedersDataLive>(
      {
        rows: built,
        kpis: {
          totalBreeders: rows.length,
          topRegion,
          avgSoldPrice: avgPx,
          avgDaysToSell: avgDays,
        },
      },
      `market_sellers + market_listings (sold to date) + listing_status_events (sold events in the last ${windowDays(filters)}d)`,
    );
  } catch (e) {
    return empty(null, `fetchBreeders error: ${errMsg(e)}`);
  }
}

function regionOfText(loc: string | null): RegionKey | null {
  if (!loc) return null;
  const s = loc.toLowerCase();
  if (/usa|united states|\bus\b|, (al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/.test(s))
    return "US";
  if (/canada|\bca$|ontario|quebec|alberta|british columbia/.test(s)) return "CA";
  if (/\buk\b|united kingdom|england|scotland|wales/.test(s)) return "UK";
  if (/\bau\b|australia|new south wales|victoria|queensland|tasmania/.test(s)) return "AU";
  if (/japan|tokyo|osaka|kyoto/.test(s)) return "JP";
  if (/sweden|stockholm|gothenburg/.test(s)) return "SE";
  if (/singapore|malaysia|thailand|indonesia|vietnam|philippines/.test(s)) return "SEA";
  if (/germany|france|netherlands|italy|spain|austria|switzerland|poland|belgium|portugal|eu/.test(s))
    return "EU";
  return null;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}
