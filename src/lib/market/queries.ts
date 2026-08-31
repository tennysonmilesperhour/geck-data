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
// widens the shapes in widget-types.ts itself. There used to be a parallel
// set of `*Live` aliases here that re-declared each widened field with an
// Omit, on the theory that widget-types would catch up later. It has, so the
// nullability now lives in one place and the aliases are gone.
"use client";
import { createClient } from "@/lib/supabase/client";
import type { Filters, SourceId } from "./types";
import {
  REGION_COLUMNS,
  type Arbitrage,
  type ArbitrageAxis,
  type BreederConcentration,
  type BreederRow,
  type BreedersData,
  type ComboDetail,
  type ComboRankSort,
  type ComboRow,
  type HeatmapCell,
  type HeatmapMetric,
  type IndexPoint,
  type MarketIndex,
  type MarketSubIndex,
  type Mover,
  type MultiSeries,
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

// A "YYYY-MM-DD" day key from combo_index_daily rendered as a compact
// axis label ("May 9"). Parsed as UTC so the label never drifts a day
// across timezones.
function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function confidenceSources(filters: Filters): SourceId[] {
  return filters.sources === "all"
    ? ["gi_sales", "gi_listings"]
    : Array.from(filters.sources);
}

// How many days of price history the warehouse actually holds, via the
// observation_span() RPC (migration 0052). Used to keep lookbacks from
// reaching past the data we have. Returns null on any failure so callers
// fall back to their own default rather than erroring.
async function observationSpanDays(
  supabase: ReturnType<typeof createClient>,
): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc("observation_span");
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    const n = Number((row as { span_days?: number | string })?.span_days);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
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
          // The index is an asking-price basket (migration 0055), so it is
          // attributed to the listings feed rather than the generic
          // sold+listings pair. Saying gi_sales here would imply the hero is
          // built on sold prices, which it is not.
          sources: ["gi_listings"],
          confidence: { score: sampleConfidence(n) },
        },
      },
      `v_market_index(${windowDays(filters)}d, ${rows.length} weeks): asking-price anchor basket`,
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
    // combo_index_daily.combo_id is the same "Trait A x Trait B" string the
    // rollup now emits as combo_name, so key the sparkline directly by it.
    // The old cross-walk mapped only the 12 curated ids to display names, so
    // every auto-discovered combo went without a sparkline; keying by combo_id
    // gives all of them one.
    for (const r of (sparkRows ?? []) as Array<{
      combo_id: string;
      median_price: number | string | null;
    }>) {
      if (r.median_price == null) continue;
      const v = Number(r.median_price);
      if (!Number.isFinite(v)) continue;
      const arr = sparkByCombo.get(r.combo_id) ?? [];
      arr.push(v);
      sparkByCombo.set(r.combo_id, arr);
    }
  } catch {
    // Non-fatal; rows just render without sparklines.
  }

  const mapped: RankedComboRow[] = rows.map((r) => {
    // Split on either separator: the rollup emits "A x B", curated names use
    // "A × B". Splitting on only one left the second trait blank.
    const parts = r.combo_name.split(/\s+(?:x|×)\s+/i);
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
// Top Movers: combo_index_movers, two disjoint observed days (migration 0051)
// ----------------------------------------------------------------------------
// This was suppressed, and the reason was structural. It read
// v_combo_rollups(w) against v_combo_rollups(2w), and 2w contains w, so every
// delta was damped toward zero by construction: a combo that doubled inside w
// was measured against a baseline that already included the doubling. No
// honest number can be recovered from nested windows.
//
// combo_index_daily holds one median per combo per observed day, so a mover
// is now that combo's index on its latest observed day against its index on a
// day at least the timeframe earlier. Two dates, nothing nested, nothing
// interpolated between them.
//
// min_n = MOVER_MIN_N on BOTH endpoints is not tuning, it is the difference
// between a mover list and a noise list. Ungated, the biggest movers here are
// combos priced off one ad: a single $5,850 listing currently sets the index
// for six combos at once and produces a +5,057% "move" on a combo whose
// latest day holds two listings.
const MOVER_MIN_N = 5;
const MOVER_ROWS_PER_SIDE = 5;

type MoverRow = {
  combo_id: string;
  from_day: string | null;
  to_day: string | null;
  from_value: number | string | null;
  to_value: number | string | null;
  from_n: number | string | null;
  to_n: number | string | null;
  pct_change: number | string | null;
  span_days: number | string | null;
};

export async function fetchTopMovers(
  filters: Filters,
): Promise<
  QueryResult<{ appreciating: Mover[]; depreciating: Mover[] } | null>
> {
  try {
    const supabase = createClient();
    const w = windowDays(filters);
    // A mover needs a baseline index day roughly `lookback` days before the
    // latest one. The observed history is far shorter than the default 12mo
    // window (about four months at time of writing), so a 365-day lookback
    // finds no baseline and the panel goes empty even though the daily index
    // is full. Cap the lookback to the span we actually have so the longest
    // honest move still shows; the note and each row carry the real from/to
    // days, so a capped window never reads as the requested one.
    const spanDays = await observationSpanDays(supabase);
    const lookback =
      spanDays != null
        ? Math.max(21, Math.min(w, spanDays - 30))
        : Math.min(w, 90);
    const { data, error } = await supabase.rpc("combo_index_movers", {
      lookback_days: lookback,
      min_n: MOVER_MIN_N,
      // Both directions come out of one ordered-by-magnitude call, so ask for
      // more than either column shows and split locally.
      max_rows: MOVER_ROWS_PER_SIDE * 8,
    });
    if (error) throw error;
    const rows = (data ?? []) as MoverRow[];
    if (rows.length === 0) {
      return empty(
        null,
        `no combo has ${MOVER_MIN_N}+ listings on both an index day and a day ${lookback}d earlier`,
      );
    }

    const mapped: Mover[] = [];
    for (const r of rows) {
      const from = num(r.from_value);
      const to = num(r.to_value);
      const pct = num(r.pct_change);
      const toN = num(r.to_n);
      const fromN = num(r.from_n);
      if (from == null || to == null || pct == null || toN == null || fromN == null) {
        continue;
      }
      mapped.push({
        combo: r.combo_id,
        // The current endpoint, which is what the row's price label describes.
        avgPrice: to,
        n: toN,
        deltaPct: pct,
        // Two observed endpoints and nothing in between. The sparkline draws
        // exactly those two points rather than inventing a path between them.
        spark: [from, to],
        fromValue: from,
        fromN,
        fromDay: r.from_day,
        toDay: r.to_day,
        attribution: {
          sources: confidenceSources(filters),
          // The move rests on the thinner of its two endpoints.
          confidence: { score: sampleConfidence(Math.min(fromN, toN)) },
        },
      });
    }

    const appreciating = mapped
      .filter((m) => m.deltaPct > 0)
      .slice(0, MOVER_ROWS_PER_SIDE);
    const depreciating = mapped
      .filter((m) => m.deltaPct < 0)
      .slice(0, MOVER_ROWS_PER_SIDE);
    if (appreciating.length === 0 && depreciating.length === 0) {
      return empty(null, "no combo index moved between the two endpoints");
    }

    const span = num(rows[0]?.span_days);
    return ok(
      { appreciating, depreciating },
      `combo_index_movers(${lookback}d, min n=${MOVER_MIN_N}): asking-price index, ${
        rows[0]?.from_day ?? "unknown"
      } to ${rows[0]?.to_day ?? "unknown"}${span != null ? `, ${span}d apart` : ""}`,
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
    // Second half of the fetch is the combo's own daily asking-price index
    // (combo_index_daily: one median per combo per observed day), the same
    // materialized view that feeds the ranked-table sparklines. `combo` here
    // is the rollup's combo_name, which is exactly the MV's combo_id, so it
    // keys directly with no cross-walk. A failure here is non-fatal: the panel
    // falls back to its "no price line yet" placeholder rather than failing
    // the whole detail fetch.
    const dailyCutoff = new Date(Date.now() - w * 86400_000)
      .toISOString()
      .slice(0, 10);
    const [blend, daily] = await Promise.all([
      supabase.rpc("v_combo_source_blend", { p_combo: combo, window_days: w }),
      supabase
        .from("combo_index_daily")
        .select("day, median_price")
        .eq("combo_id", combo)
        .gte("day", dailyCutoff)
        .order("day", { ascending: true })
        .limit(400),
    ]);
    if (blend.error) throw blend.error;
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
    // Build the single daily asking-price line from combo_index_daily. It is
    // the same median-per-day series behind the ranked-table sparkline, drawn
    // full-size here. Still a single honest series (asking price), not the
    // multi-source sold/ask overlay from the mock preview, so it is labelled
    // for exactly what it is. Two points are the minimum for a line; below
    // that the panel keeps its placeholder.
    const dailyRows = (daily.data ?? []) as Array<{
      day: string;
      median_price: number | string | null;
    }>;
    const points: IndexPoint[] = dailyRows
      .filter((d) => d.median_price != null && Number.isFinite(Number(d.median_price)))
      .map((d) => ({ t: shortDay(d.day), v: Math.round(Number(d.median_price)) }));
    const priceSeries: MultiSeries[] =
      points.length >= 2
        ? [{ name: "Median asking price", color: "#34d399", points }]
        : [];
    return ok<ComboDetail>(
      {
        combo: combo as ComboDetail["combo"],
        meanBlendedPrice: totalPct > 0 ? Math.round(weighted / totalPct) : null,
        range: null,
        observations,
        series: priceSeries,
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
    "#34d399", "#60a5fa", "#a78bfa", "#f472b6", "#fbbf24", "#fb7185",
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
    const [sold, statuses, profiles] = await Promise.all([
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
      supabase
        .from("sellers")
        .select("seller_slug, avatar_url")
        .in("seller_slug", ids),
    ]);
    const avatarBySeller = new Map<string, string>();
    for (const profile of (profiles.data ?? []) as Array<{
      seller_slug: string;
      avatar_url: string | null;
    }>) {
      if (!profile.avatar_url) continue;
      try {
        const url = new URL(profile.avatar_url);
        if (
          url.protocol === "https:" &&
          url.hostname === "d2bjn9a420fiq0.cloudfront.net"
        ) {
          avatarBySeller.set(profile.seller_slug, url.toString());
        }
      } catch {
        // Malformed captured URLs stay out of the render path.
      }
    }
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
    const built: BreederRow[] = rows.slice(0, 12).map((s) => {
      const soldAgg = soldBySeller.get(s.seller_id);
      const daysArr = daysBySeller.get(s.seller_id) ?? [];
      const avgDays =
        daysArr.length === 0
          ? null
          : Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length);
      const region = regionOfText(s.seller_location) as RegionKey | null;
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
        avatarUrl: avatarBySeller.get(s.seller_id) ?? null,
        region,
        activeListings: Math.max(0, s.total_listings ?? 0),
        soldInWindow: soldAgg?.sold ?? 0,
        avgSoldPrice:
          soldAgg && soldAgg.priced > 0
            ? Math.round(soldAgg.sumPx / soldAgg.priced)
            : null,
        avgDaysToSell: avgDays,
        specialty: "no data" as BreedersData["rows"][number]["specialty"],
        velocity: [],
        lineageScore,
        attribution: {
          sources: ["gi_listings"] as SourceId[],
          confidence: { score: sampleConfidence(soldAgg?.sold ?? 0) },
        },
      };
    });
    // Only sellers whose location actually parsed get a vote. Counting the
    // unmapped ones as US is how "Top region: US" used to be manufactured out
    // of missing data.
    const byRegion = new Map<RegionKey, number>();
    for (const r of built) {
      if (!r.region) continue;
      byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + 1);
    }
    const regionMapped = built.filter((r) => r.region != null).length;
    const topRegion =
      [...byRegion.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
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
    return ok<BreedersData>(
      {
        rows: built,
        kpis: {
          totalBreeders: rows.length,
          topRegion,
          regionMapped,
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

// ----------------------------------------------------------------------------
// Seller concentration: share of the tracked live catalogue held by each
// seller. Powers the concentration bar chart on the Breeders tab (the
// preview's market-share panel). The honest caveat is baked into the shape:
// MorphMarket's public API returns no owner on ~88% of listings, so the
// denominator is the ~12% that carry an identified seller, and the widget
// labels the coverage rather than implying a whole-market reading.
// ----------------------------------------------------------------------------
const CONCENTRATION_TOP_N = 12;

export async function fetchBreederConcentration(
  _filters: Filters,
): Promise<QueryResult<BreederConcentration | null>> {
  try {
    const supabase = createClient();
    // Aggregated in the database (migration 0056) so the counts never hit
    // PostgREST's row cap and the totals stay exact. One round trip returns
    // the top-N rows plus the scalars the panel labels itself with.
    const { data, error } = await supabase.rpc("v_breeder_concentration", {
      top_n: CONCENTRATION_TOP_N,
    });
    if (error) throw error;
    const payload = (data ?? null) as {
      rows?: BreederConcentration["rows"];
      totalAttributed?: number;
      sellerCount?: number;
      liveTotal?: number;
      top10Pct?: number;
    } | null;
    const rows = payload?.rows ?? [];
    const totalAttributed = payload?.totalAttributed ?? 0;
    if (rows.length === 0 || totalAttributed === 0) {
      return empty(null, "no live listing carries an identified seller yet");
    }
    const liveTotal = payload?.liveTotal ?? 0;
    const coveragePct =
      liveTotal > 0 ? Math.round((totalAttributed / liveTotal) * 1000) / 10 : 0;

    return ok<BreederConcentration>(
      {
        rows,
        totalAttributed,
        sellerCount: payload?.sellerCount ?? rows.length,
        coveragePct,
        top10Pct: payload?.top10Pct ?? 0,
        attribution: {
          sources: ["gi_listings"],
          confidence: { score: sampleConfidence(totalAttributed) },
        },
      },
      `v_breeder_concentration: ${
        payload?.sellerCount ?? rows.length
      } sellers over ${totalAttributed} attributed listings`,
    );
  } catch (e) {
    return empty(null, `fetchBreederConcentration error: ${errMsg(e)}`);
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
