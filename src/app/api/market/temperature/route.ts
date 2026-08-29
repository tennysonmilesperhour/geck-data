// Public market temperature endpoint.
//
// Returns a 52 week weekly series plus a single composite scalar (0..100)
// for "is the crested market hot or cold this week?".
//
// Backed by v_market_temperature (migration 0029). The composite scoring is
// done here so we can re-tune weights without a schema change.
//
// COVERAGE GATES. Three of the four components are demand measures taken from
// captured sold events, and the sold stream is the thinnest thing this project
// owns. The previous version coalesced every missing component to 0 and
// rescale() returned 0.5 whenever the baseline had no spread, so a week with
// no sold evidence whatsoever scored exactly 50 and the card printed
// "50 Warm". That is the arithmetic of an empty baseline, not a reading of the
// market. Now a missing component normalises to null, the gates below decide
// whether any score may be published at all, and a failed gate returns
// score: null with a machine-readable reason plus the newest sold date, so
// the card can say what is missing instead of inventing a tier word.
//
// As of this writing every gate fails: the newest captured sale is 2026-05-14
// and nothing has sold in view since, so the honest answer is unavailable.
//
// Cached at the edge for 1 hour, since weekly buckets do not move faster than
// that and the cost of recomputing is dominated by the underlying view.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

// How recently a captured sale has to have happened before it says anything
// about the market *this* week.
const RECENT_WEEKS = 8;
// Captured sold events required inside that window before any score ships.
// The entire captured pool is 92 events, so this is a floor under "we can
// still see the demand side", not a test of statistical power.
const MIN_RECENT_SOLD = 20;
// Weeks that must carry a complete observation before the trailing series is
// a baseline. Percentiles over one or two weeks are not a distribution.
const MIN_SCORED_WEEKS = 12;

type WeekRow = {
  week_start: string;
  listed_n: number | null;
  sold_n: number | null;
  sell_through: number | null;
  median_sold_usd: number | null;
  median_days_to_sell: number | null;
};

type WeekPoint = {
  week_start: string;
  listed_n: number;
  sold_n: number;
  sell_through: number | null;
  median_sold_usd: number | null;
  median_days_to_sell: number | null;
  // null whenever the week is missing a component. A week nobody sold in is
  // not a cold week, it is an unmeasured one.
  temperature: number | null;
};

type UnavailableReason =
  | "no_rows"
  | "stale_sold_stream"
  | "thin_recent_sold"
  | "thin_baseline"
  | "degenerate_baseline"
  | "latest_week_unscored";

type Band = { p10: number; p90: number } | null;

function percentile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

// A baseline only exists when the trailing distribution has spread. A flat or
// single-point series used to collapse to rescale()'s 0.5, which is how "no
// variation" got published as "perfectly average".
function bandOf(xs: number[]): Band {
  const p10 = percentile(xs, 0.1);
  const p90 = percentile(xs, 0.9);
  if (p10 == null || p90 == null || p90 <= p10) return null;
  return { p10, p90 };
}

function rescale(v: number | null, band: Band): number | null {
  if (v == null || !Number.isFinite(v) || band == null) return null;
  return Math.max(0, Math.min(1, (v - band.p10) / (band.p90 - band.p10)));
}

// The view emits null, not zero, for a week with no sold rows. Zero-filling
// those is what let unobserved weeks vote in the baseline and drag the
// composite toward the middle.
function isComplete(r: WeekRow): boolean {
  return (
    r.listed_n != null &&
    r.sell_through != null &&
    r.median_sold_usd != null &&
    r.median_days_to_sell != null
  );
}

function isoDay(ts: string | null): string | null {
  return ts ? ts.slice(0, 10) : null;
}

function ageInDays(ts: string | null): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}

// Newest sale on record, optionally restricted to one basis. v_sold_reconciled
// (migration 0045) keeps the two pools apart: captured_event is a sold
// transition the pipeline actually watched, inferred_unseen is a listing that
// stopped appearing in the catalog walk. Only the captured pool feeds
// v_market_temperature, so that is the date the gate reports.
async function newestSoldAt(
  admin: ReturnType<typeof createAdminClient>,
  basis: "captured_event" | null,
): Promise<string | null> {
  // Postgres sorts NULLs first on a descending order, so an undated row would
  // otherwise come back as "the newest sale" and read as no sale at all.
  const base = admin.from("v_sold_reconciled").select("sold_at").not("sold_at", "is", null);
  const filtered = basis ? base.eq("sold_basis", basis) : base;
  const { data, error } = await filtered
    .order("sold_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as { sold_at: string | null } | null)?.sold_at ?? null;
}

export async function GET(_req: NextRequest) {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "admin" }, { status: 500 });
  }

  const [weekly, newestCaptured, newestAny] = await Promise.all([
    admin.from("v_market_temperature").select("*").order("week_start", { ascending: true }),
    newestSoldAt(admin, "captured_event"),
    newestSoldAt(admin, null),
  ]);
  if (weekly.error) {
    return NextResponse.json({ error: weekly.error.message }, { status: 500 });
  }
  const rows = (weekly.data ?? []) as WeekRow[];

  // Normalisation baselines come only from weeks that carry every component,
  // so this week is ranked against weeks that were actually observed.
  // Velocity is inverted: selling faster is hotter.
  const complete = rows.filter(isComplete);
  const components = [
    {
      key: "sell_through",
      label: "sell-through",
      weight: 0.35,
      invert: false,
      value: (r: WeekRow) => r.sell_through,
    },
    {
      key: "velocity",
      label: "days to sell",
      weight: 0.3,
      invert: true,
      value: (r: WeekRow) => r.median_days_to_sell,
    },
    {
      key: "volume",
      label: "listing volume",
      weight: 0.2,
      invert: false,
      value: (r: WeekRow) => r.listed_n,
    },
    {
      key: "price",
      label: "median sold price",
      weight: 0.15,
      invert: false,
      value: (r: WeekRow) => r.median_sold_usd,
    },
  ] as const;
  const bands: Band[] = components.map((c) =>
    bandOf(complete.map((r) => c.value(r) as number)),
  );

  function scoreWeek(r: WeekRow): number | null {
    let total = 0;
    for (let i = 0; i < components.length; i++) {
      const c = components[i];
      const n = rescale(c.value(r), bands[i] ?? null);
      if (n == null) return null;
      total += c.weight * (c.invert ? 1 - n : n);
    }
    return Math.round(total * 100);
  }

  const series: WeekPoint[] = rows.map((r) => ({
    week_start: r.week_start,
    listed_n: r.listed_n ?? 0,
    sold_n: r.sold_n ?? 0,
    sell_through: r.sell_through,
    median_sold_usd: r.median_sold_usd,
    median_days_to_sell: r.median_days_to_sell,
    temperature: scoreWeek(r),
  }));

  const recentSold = rows
    .slice(-RECENT_WEEKS)
    .reduce((sum, r) => sum + (r.sold_n ?? 0), 0);
  const capturedDay = isoDay(newestCaptured);
  const capturedAge = ageInDays(newestCaptured);
  const inferredDay = isoDay(newestAny);
  const inferredIsNewer =
    newestAny != null &&
    (newestCaptured == null || Date.parse(newestAny) > Date.parse(newestCaptured));
  const flatComponents = components
    .filter((_, i) => bands[i] == null)
    .map((c) => c.label);
  const latest = series[series.length - 1] ?? null;
  const prev = series[series.length - 2] ?? null;

  // Gates, most informative failure first. Each one is a reason a viewer can
  // act on, not a generic "no data".
  let reason: UnavailableReason | null = null;
  let detail: string | null = null;
  if (rows.length === 0) {
    reason = "no_rows";
    detail = "The weekly temperature view returned no weeks, so there is nothing to score.";
  } else if (recentSold <= 0) {
    reason = "stale_sold_stream";
    detail = capturedDay
      ? `Nothing has sold in view for ${RECENT_WEEKS} weeks. The newest captured sale is ${capturedDay}, ${capturedAge} days ago.` +
        (inferredIsNewer
          ? ` Sales after that are only inferred from listings that stopped appearing (newest ${inferredDay}), which this score does not count.`
          : "")
      : "No captured sale is on record, so the demand side of this score has nothing to measure.";
  } else if (recentSold < MIN_RECENT_SOLD) {
    reason = "thin_recent_sold";
    detail =
      `Only ${recentSold} captured sales in the last ${RECENT_WEEKS} weeks, under the ${MIN_RECENT_SOLD} this score requires.` +
      (capturedDay ? ` Newest captured sale ${capturedDay}.` : "");
  } else if (complete.length < MIN_SCORED_WEEKS) {
    reason = "thin_baseline";
    detail = `Only ${complete.length} of ${rows.length} weeks carry a complete sold observation, under the ${MIN_SCORED_WEEKS} needed to rank this week against the year.`;
  } else if (flatComponents.length > 0) {
    reason = "degenerate_baseline";
    detail = `The trailing baseline has no spread in ${flatComponents.join(", ")}, so this week cannot be ranked against it.`;
  } else if (latest?.temperature == null) {
    reason = "latest_week_unscored";
    detail = "The current week has no complete sold observation yet, so it cannot be scored.";
  }

  const score = reason == null ? (latest?.temperature ?? null) : null;
  const prevScore = prev?.temperature ?? null;
  const delta = score != null && prevScore != null ? score - prevScore : null;

  return NextResponse.json(
    {
      score,
      status: reason == null ? "ok" : "unavailable",
      unavailable_reason: reason,
      unavailable_detail: detail,
      newest_sold_at: newestCaptured,
      newest_sold_basis: newestCaptured ? "captured_event" : null,
      newest_inferred_sold_at: inferredIsNewer ? newestAny : null,
      delta_vs_last_week: delta,
      coverage: {
        weeks: rows.length,
        scored_weeks: complete.length,
        min_scored_weeks: MIN_SCORED_WEEKS,
        recent_sold_events: recentSold,
        recent_window_weeks: RECENT_WEEKS,
        min_recent_sold_events: MIN_RECENT_SOLD,
        flat_components: flatComponents,
      },
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
