import "server-only";

import { unstable_cache } from "next/cache";
import type { SoldBasis, SoldRow } from "@/components/sold/SortableSoldTable";
import { createPublicClient } from "@/lib/supabase/public";
import {
  aggregateSoldEvents,
  normaliseSoldActivity,
  type SoldActivityWeek,
  type SoldEvent,
} from "./activity";

const ACTIVITY_WEEKS = 26;
const FALLBACK_EVENT_LIMIT = 20_000;

// Both pools share a column list so the table, the CSV and the charts read
// the same row shape whichever basis is on screen.
const SOLD_COLUMNS =
  "id, seller_id, title, price, price_usd_equivalent, maturity, sex, first_seen_at, sold_at, days_to_sell, sold_basis, sold_source, is_group_lot";

// Newest rows pulled per pool. The inferred pool is 2,840 rows deep and
// nobody pages through that, but the pool size still has to be reported
// honestly, so the pool count comes from a count query rather than from
// rows.length. That mismatch is what produced "92 sold all time" under a
// table that was really the last 500 rows.
const POOL_ROW_LIMIT = 500;

// days_to_sell survives on a minority of rows (8 of 92 captured, 315 of
// 2,840 inferred), so every measurable row in a pool fits in one thin
// query. Taking the median from the POOL_ROW_LIMIT slice instead would
// quietly turn it into "median of the most recent 500", a different number.
const MEASURABLE_DAYS_LIMIT = 5_000;

export type SoldPool = {
  basis: SoldBasis;
  /** The newest POOL_ROW_LIMIT rows, group lots included. */
  rows: SoldRow[];
  /** True row count for this basis, independent of rows.length. */
  total: number;
  /** Group lots in the whole pool. null means the count could not be read. */
  groupLots: number | null;
  /** Every non-null days_to_sell in the pool, not only inside `rows`. */
  measurableDays: number[] | null;
  oldestSoldAt: string | null;
  newestSoldAt: string | null;
};

export type SoldPageData = {
  captured: SoldPool | null;
  inferred: SoldPool | null;
  activity: SoldActivityWeek[];
  generatedAt: string;
  error: string | null;
};

// One pool of v_sold_reconciled (migration 0045). The old sold_listings_v
// joined listing_status_events alone, so the 2,840 inferred sales from May
// and June never reached this page at all. The two bases stay in separate
// pools here because their price semantics and their inference methods
// differ: unioning them would produce a count nobody could interpret.
async function fetchPool(
  supabase: ReturnType<typeof createPublicClient>,
  basis: SoldBasis,
): Promise<{ pool: SoldPool | null; error: string | null }> {
  const [rowsRes, lotsRes, daysRes, oldestRes] = await Promise.all([
    supabase
      .from("v_sold_reconciled")
      .select(SOLD_COLUMNS, { count: "exact" })
      .eq("sold_basis", basis)
      .order("sold_at", { ascending: false })
      .limit(POOL_ROW_LIMIT),
    supabase
      .from("v_sold_reconciled")
      .select("id", { count: "exact", head: true })
      .eq("sold_basis", basis)
      .eq("is_group_lot", true),
    supabase
      .from("v_sold_reconciled")
      .select("days_to_sell")
      .eq("sold_basis", basis)
      .not("days_to_sell", "is", null)
      .limit(MEASURABLE_DAYS_LIMIT),
    // The oldest sale cannot be read off the tail of `rows` once the pool
    // is deeper than POOL_ROW_LIMIT, and the covered window is the whole
    // point of this page, so it gets its own one-row query.
    supabase
      .from("v_sold_reconciled")
      .select("sold_at")
      .eq("sold_basis", basis)
      .not("sold_at", "is", null)
      .order("sold_at", { ascending: true })
      .limit(1),
  ]);

  if (rowsRes.error) {
    return { pool: null, error: rowsRes.error.message };
  }

  const rows = (rowsRes.data ?? []) as SoldRow[];
  const measurableDays = daysRes.error
    ? null
    : ((daysRes.data ?? []) as { days_to_sell: number | null }[])
        .map((row) => row.days_to_sell)
        .filter((day): day is number => typeof day === "number" && day >= 0);
  const oldest = oldestRes.error
    ? null
    : (((oldestRes.data ?? []) as { sold_at: string | null }[])[0]?.sold_at ??
      null);

  return {
    pool: {
      basis,
      rows,
      total: rowsRes.count ?? rows.length,
      // A failed count is unknown, not zero. The UI says so rather than
      // claiming a pool has no group lots.
      groupLots: lotsRes.error ? null : (lotsRes.count ?? null),
      measurableDays,
      oldestSoldAt: oldest,
      newestSoldAt: rows.find((row) => row.sold_at)?.sold_at ?? null,
    },
    error: null,
  };
}

async function fetchSoldPageData(): Promise<SoldPageData> {
  const generatedAt = new Date().toISOString();
  try {
    const supabase = createPublicClient();
    const [captured, inferred, activityResult] = await Promise.all([
      fetchPool(supabase, "captured_event"),
      fetchPool(supabase, "inferred_unseen"),
      supabase.rpc("sold_activity_weekly", { p_weeks: ACTIVITY_WEEKS }),
    ]);

    const failure = captured.error ?? inferred.error;
    if (failure || !captured.pool || !inferred.pool) {
      return {
        captured: null,
        inferred: null,
        activity: [],
        generatedAt,
        error: failure ?? "Sold ledger returned no pools",
      };
    }

    // sold_activity_weekly counts listing_status_events only, so this series
    // is the captured pool and nothing else. The page labels it that way.
    let activity: SoldActivityWeek[] = [];
    if (!activityResult.error) {
      activity = normaliseSoldActivity(
        (activityResult.data ?? []) as {
          week_start: string;
          sold_count: number | string;
        }[],
      );
    } else {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - ACTIVITY_WEEKS * 7);
      const fallback = await supabase
        .from("listing_status_events")
        .select("observed_at")
        .eq("status", "sold")
        .gte("observed_at", start.toISOString())
        .order("observed_at", { ascending: true })
        .limit(FALLBACK_EVENT_LIMIT);

      if (!fallback.error) {
        activity = aggregateSoldEvents((fallback.data ?? []) as SoldEvent[]);
      }
    }

    return {
      captured: captured.pool,
      inferred: inferred.pool,
      activity,
      generatedAt,
      error: null,
    };
  } catch (error) {
    return {
      captured: null,
      inferred: null,
      activity: [],
      generatedAt,
      error: error instanceof Error ? error.message : "Unknown data error",
    };
  }
}

export const getSoldPageData = unstable_cache(
  fetchSoldPageData,
  ["sold-page-data-v3"],
  { revalidate: 300, tags: ["sold-data"] },
);
