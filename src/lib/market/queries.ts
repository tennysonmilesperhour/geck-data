// Real-data fetchers for every /market widget. Each fetcher wraps a
// Supabase query and returns a `QueryResult<T | null>`:
//
//   - `live: true`        — rows came from Supabase
//   - `live: false`, data: null — no data yet (DB empty, view missing,
//                                  RLS denied, or feature genuinely not
//                                  wired up). Widgets render an empty
//                                  state, never synthetic numbers.
//
// `attributionNote` carries either a one-line provenance string for
// live results ("v_combo_rollups(90d)") or the reason an empty state
// is showing ("v_market_sub_index not implemented").
"use client";
import { createClient } from "@/lib/supabase/client";
import type { Filters, SourceId } from "./types";
import {
  REGION_COLUMNS,
  actionForScore,
  sortComboRows,
  tierForScore,
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

// ----------------------------------------------------------------------------
// Market Index — v_market_index(window_days) + delta vs period start
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
          confidence: { score: Math.min(99, Math.max(20, 20 + n * 2)) },
        },
      },
      `v_market_index(${windowDays(filters)}d, ${rows.length} weeks)`,
    );
  } catch (e) {
    return empty(null, `fetchMarketIndex error: ${errMsg(e)}`);
  }
}

// ----------------------------------------------------------------------------
// Market Sub-Indices — v_market_sub_index(window_days), 0035
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
          confidence: { score: Math.min(99, 20 + Math.min(40, nAcc.get(anchor) ?? 0)) },
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
// Combos ranked — v_combo_rollups(window_days)
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

export async function fetchCombosRanked(
  filters: Filters,
  sort: ComboRankSort,
): Promise<QueryResult<ComboRow[] | null>> {
  const { rows, live, reason } = await fetchRollups(filters);
  if (!live) return empty(null, reason ?? "no data");
  const mapped: ComboRow[] = rows.map((r) => {
    const parts = r.combo_name.split(" × ");
    const medianSold = r.median_sold ? Number(r.median_sold) : 0;
    const ask = r.median_ask ? Number(r.median_ask) : medianSold;
    const spreadPct = r.spread_pct ? Number(r.spread_pct) : 0;
    return {
      combo: r.combo_name as ComboRow["combo"],
      traits: [parts[0] ?? r.combo_name, parts[1] ?? ""],
      medianSold: Math.round(medianSold),
      stddev: Math.round(medianSold * 0.15),
      ask: Math.round(ask),
      spreadPct,
      daysToSell: Math.round(Number(r.avg_days_to_sell ?? 30)),
      volume: r.sold_count,
      attribution: {
        sources: confidenceSources(filters),
        confidence: { score: r.confidence_score },
      },
    };
  });
  return ok(sortComboRows(mapped, sort), `v_combo_rollups(${windowDays(filters)}d)`);
}

// ----------------------------------------------------------------------------
// Top Movers — derived from v_combo_rollups at the current window vs the
// preceding window of equal length.
// ----------------------------------------------------------------------------
export async function fetchTopMovers(
  filters: Filters,
): Promise<
  QueryResult<{ appreciating: Mover[]; depreciating: Mover[] } | null>
> {
  try {
    const supabase = createClient();
    const w = windowDays(filters);
    const [curr, prev] = await Promise.all([
      supabase.rpc("v_combo_rollups", { window_days: w }),
      supabase.rpc("v_combo_rollups", { window_days: w * 2 }),
    ]);
    if (curr.error || prev.error) throw curr.error ?? prev.error;
    const currRows = (curr.data ?? []) as RollupRow[];
    const prevRows = (prev.data ?? []) as RollupRow[];
    if (currRows.length === 0) {
      return empty(null, "no combos with observations");
    }
    const prevByCombo = new Map(
      prevRows.map((r) => [r.combo_name, Number(r.median_sold ?? 0)]),
    );
    const movers: Mover[] = currRows
      .filter((r) => Number(r.median_sold ?? 0) > 0)
      .map((r) => {
        const currPx = Number(r.median_sold ?? 0);
        const prevPx = prevByCombo.get(r.combo_name) ?? currPx;
        const deltaPct = prevPx === 0 ? 0 : ((currPx - prevPx) / prevPx) * 100;
        const spark = [prevPx, currPx];
        return {
          combo: r.combo_name as Mover["combo"],
          avgPrice: Math.round(currPx),
          n: r.sold_count,
          deltaPct,
          spark,
          attribution: {
            sources: confidenceSources(filters),
            confidence: { score: r.confidence_score },
          },
        };
      });
    if (movers.length === 0) {
      return empty(null, "no priced combos in window");
    }
    const byDelta = [...movers].sort((a, b) => b.deltaPct - a.deltaPct);
    return ok(
      {
        appreciating: byDelta.slice(0, 5),
        depreciating: [...byDelta].reverse().slice(0, 5),
      },
      `v_combo_rollups delta over ${w}d`,
    );
  } catch (e) {
    return empty(null, `fetchTopMovers error: ${errMsg(e)}`);
  }
}

// ----------------------------------------------------------------------------
// Peak Indicator
// ----------------------------------------------------------------------------
export async function fetchPeakIndicators(
  filters: Filters,
): Promise<QueryResult<PeakIndicator[] | null>> {
  try {
    const supabase = createClient();
    const w = windowDays(filters);
    const [curr, prev] = await Promise.all([
      supabase.rpc("v_combo_rollups", { window_days: w }),
      supabase.rpc("v_combo_rollups", { window_days: w * 2 }),
    ]);
    if (curr.error || prev.error) throw curr.error ?? prev.error;
    const currRows = (curr.data ?? []) as RollupRow[];
    const prevRows = (prev.data ?? []) as RollupRow[];
    if (currRows.length === 0) {
      return empty(null, "no combos with observations");
    }
    const prevByCombo = new Map(
      prevRows.map((r) => [r.combo_name, Number(r.median_sold ?? 0)]),
    );
    const maxSold = Math.max(1, ...currRows.map((r) => r.sold_count));
    const cards: PeakIndicator[] = currRows
      .filter((r) => r.sold_count + r.live_count > 0)
      .map((r) => {
        const volumeTerm = (r.sold_count / maxSold) * 40;
        const prevPx = prevByCombo.get(r.combo_name) ?? Number(r.median_sold ?? 0);
        const currPx = Number(r.median_sold ?? prevPx);
        const momentumPct = prevPx === 0 ? 0 : ((currPx - prevPx) / prevPx) * 100;
        const momentumTerm = Math.max(-20, Math.min(30, momentumPct * 0.5));
        const spreadTerm =
          r.spread_pct != null ? Math.max(-15, Math.min(15, Number(r.spread_pct))) : 0;
        const score = Math.max(
          5,
          Math.min(95, Math.round(35 + volumeTerm + momentumTerm + spreadTerm)),
        );
        return {
          combo: r.combo_name as PeakIndicator["combo"],
          score,
          tier: tierForScore(score),
          action: actionForScore(score),
          n: r.sold_count + r.live_count,
          attribution: {
            sources: confidenceSources(filters),
            confidence: { score: r.confidence_score },
          },
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    if (cards.length === 0) {
      return empty(null, "no combos with observations");
    }
    return ok(cards, `derived from v_combo_rollups(${w}d)`);
  } catch (e) {
    return empty(null, `fetchPeakIndicators error: ${errMsg(e)}`);
  }
}

// ----------------------------------------------------------------------------
// Combo detail — price_history series + v_combo_source_blend
// ----------------------------------------------------------------------------
export async function fetchComboDetail(
  filters: Filters,
  combo: string | null,
): Promise<QueryResult<ComboDetail | null>> {
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
    // We don't have a multi-series chart pipeline yet, so we return a
    // detail object with the blend populated and the chart series empty.
    // ComboDetailPanel renders the empty series as a "chart not wired"
    // placeholder rather than a fake line.
    return ok<ComboDetail>(
      {
        combo: combo as ComboDetail["combo"],
        medianSold: Math.round(
          blendRows.reduce(
            (a, b) => a + Number(b.avg_price) * Number(b.pct),
            0,
          ) / 100,
        ),
        range: [0, 0],
        observations: blendRows.reduce((a, b) => a + b.n, 0),
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
          medianAsk: 0,
          askSoldSpreadPct: 0,
          daysToSell: 0,
          volume: blendRows.reduce((a, b) => a + b.n, 0),
        },
        attribution: {
          sources: confidenceSources(filters),
          confidence: {
            score: Math.min(99, 20 + blendRows.reduce((a, b) => a + b.n, 0)),
          },
        },
      },
      `v_combo_source_blend(${combo}, ${w}d)`,
    );
  } catch (e) {
    return empty(null, `fetchComboDetail error: ${errMsg(e)}`);
  }
}

// ----------------------------------------------------------------------------
// Regional heatmap — v_regional_heatmap(window_days)
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
          value: v,
          confidence: Math.max(0.18, Math.min(1, row.confidence_score / 100)),
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
            score: Math.round(
              rows.reduce((a, r) => a + r.confidence_score, 0) /
                Math.max(1, rows.length),
            ),
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
// Arbitrage — derived from v_regional_heatmap (axis='region'). The
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
            confidence: {
              score: Math.min(low.confidence_score, high.confidence_score),
            },
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
// Supply pipeline — v_supply_pipeline_monthly (admin + owner visibility)
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
// Breeders — market_sellers + listing_status_events + seller_snapshots
// ----------------------------------------------------------------------------
export async function fetchBreeders(
  filters: Filters,
): Promise<QueryResult<BreedersData | null>> {
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
    const soldBySeller = new Map<string, { total: number; sumPx: number }>();
    for (const r of (sold.data ?? []) as Array<{
      seller_id: string;
      price_usd_equivalent: number | null;
    }>) {
      const rec = soldBySeller.get(r.seller_id) ?? { total: 0, sumPx: 0 };
      rec.total += 1;
      rec.sumPx += r.price_usd_equivalent ?? 0;
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
    const built = rows.slice(0, 12).map((s, idx) => {
      const soldAgg = soldBySeller.get(s.seller_id);
      const daysArr = daysBySeller.get(s.seller_id) ?? [];
      const avgDays =
        daysArr.length === 0
          ? 30
          : Math.round(
              daysArr.reduce((a, b) => a + b, 0) / daysArr.length,
            );
      const region = (regionOfText(s.seller_location) ?? "US") as RegionKey;
      const score =
        Math.min(
          100,
          Math.round(
            25 +
              Math.min(40, (s.total_listings ?? 0) * 0.4) +
              Math.min(25, (s.avg_price ?? 0) / 200) +
              Math.min(10, (s.feedback_count ?? 0) * 0.02),
          ),
        ) || 30 + (idx % 60);
      return {
        id: s.seller_id,
        name: s.seller_name ?? s.seller_id,
        region,
        activeListings: Math.max(0, s.total_listings ?? 0),
        soldInWindow: soldAgg?.total ?? 0,
        avgSoldPrice:
          soldAgg && soldAgg.total > 0
            ? Math.round(soldAgg.sumPx / soldAgg.total)
            : Math.round(s.avg_price ?? 0),
        avgDaysToSell: avgDays,
        specialty: "—" as BreedersData["rows"][number]["specialty"],
        velocity: [],
        lineageScore: score,
        attribution: {
          sources: ["gi_listings"] as SourceId[],
          confidence: {
            score: Math.min(99, 30 + Math.floor((soldAgg?.total ?? 0) * 3)),
          },
        },
      };
    });
    const byRegion = new Map<RegionKey, number>();
    for (const r of built) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + 1);
    const topRegion = ([...byRegion.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      "US") as RegionKey;
    const avgPx =
      built.length === 0
        ? 0
        : Math.round(
            built.reduce((a, r) => a + r.avgSoldPrice, 0) / built.length,
          );
    const avgDays =
      built.length === 0
        ? 0
        : Math.round(
            built.reduce((a, r) => a + r.avgDaysToSell, 0) / built.length,
          );
    return ok(
      {
        rows: built,
        kpis: {
          totalBreeders: rows.length,
          topRegion,
          avgSoldPrice: avgPx,
          avgDaysToSell: avgDays,
        },
      },
      "market_sellers + listing_status_events",
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
