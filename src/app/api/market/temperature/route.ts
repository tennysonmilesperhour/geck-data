// Public market temperature endpoint.
//
// Returns a 52-week weekly series plus a single composite scalar (0..100)
// for "is the crested market hot or cold this week?".
//
// Backed by v_market_temperature (migration 0029). The composite scoring
// is done here so we can re-tune weights without a schema change.
//
// Cached at the edge for 1 hour — weekly buckets don't move faster than
// that and the cost of recomputing is dominated by the underlying view.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WeekRow = {
  week_start: string;
  listed_n: number | null;
  sold_n: number | null;
  sell_through: number | null;
  median_sold_usd: number | null;
  median_days_to_sell: number | null;
};

function rescale(v: number, p10: number, p90: number): number {
  if (!Number.isFinite(v) || p90 <= p10) return 0.5;
  return Math.max(0, Math.min(1, (v - p10) / (p90 - p10)));
}

function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

export async function GET(_req: NextRequest) {
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "admin" }, { status: 500 });
  }

  const { data, error } = await admin
    .from("v_market_temperature")
    .select("*")
    .order("week_start", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as WeekRow[];
  if (rows.length === 0) {
    return NextResponse.json({ score: null, series: [], generated_at: new Date().toISOString() });
  }

  // Build normalisation baselines from the historical series so this week's
  // values are scored against last year. Inverted for days-to-sell so faster
  // (lower) = hotter.
  const listed = rows.map((r) => r.listed_n ?? 0);
  const sellThrough = rows.map((r) => r.sell_through ?? 0);
  const medianPrice = rows.map((r) => r.median_sold_usd ?? 0);
  const days = rows.map((r) => r.median_days_to_sell ?? 0);

  const listedP10 = percentile(listed, 0.1);
  const listedP90 = percentile(listed, 0.9);
  const stP10 = percentile(sellThrough, 0.1);
  const stP90 = percentile(sellThrough, 0.9);
  const priceP10 = percentile(medianPrice, 0.1);
  const priceP90 = percentile(medianPrice, 0.9);
  const daysP10 = percentile(days, 0.1);
  const daysP90 = percentile(days, 0.9);

  const series = rows.map((r) => {
    const volumeN = rescale(r.listed_n ?? 0, listedP10, listedP90);
    const sellThroughN = rescale(r.sell_through ?? 0, stP10, stP90);
    const velocityN = 1 - rescale(r.median_days_to_sell ?? 0, daysP10, daysP90);
    const priceN = rescale(r.median_sold_usd ?? 0, priceP10, priceP90);
    // Weights — sell-through and velocity are the strongest signals.
    const composite =
      0.35 * sellThroughN + 0.30 * velocityN + 0.20 * volumeN + 0.15 * priceN;
    return {
      week_start: r.week_start,
      listed_n: r.listed_n ?? 0,
      sold_n: r.sold_n ?? 0,
      sell_through: r.sell_through ?? 0,
      median_sold_usd: r.median_sold_usd ?? null,
      median_days_to_sell: r.median_days_to_sell ?? null,
      temperature: Math.round(composite * 100),
    };
  });
  const score = series[series.length - 1]?.temperature ?? null;
  const prev = series[series.length - 2]?.temperature ?? null;
  const delta = score != null && prev != null ? score - prev : null;

  return NextResponse.json(
    {
      score,
      delta_vs_last_week: delta,
      series,
      generated_at: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
