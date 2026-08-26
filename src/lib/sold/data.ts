import "server-only";

import { unstable_cache } from "next/cache";
import type { SoldRow } from "@/components/sold/SortableSoldTable";
import { createPublicClient } from "@/lib/supabase/public";
import {
  aggregateSoldEvents,
  normaliseSoldActivity,
  type SoldActivityWeek,
  type SoldEvent,
} from "./activity";

const ACTIVITY_WEEKS = 26;
const FALLBACK_EVENT_LIMIT = 20_000;

export type SoldPageData = {
  rows: SoldRow[];
  activity: SoldActivityWeek[];
  generatedAt: string;
  error: string | null;
};

async function fetchSoldPageData(): Promise<SoldPageData> {
  try {
    const supabase = createPublicClient();
    const [listingsResult, activityResult] = await Promise.all([
      supabase
        .from("sold_listings_v")
        .select(
          "id, seller_id, title, price, price_usd_equivalent, maturity, sex, first_seen_at, sold_at, days_to_sell, sold_source",
        )
        .order("sold_at", { ascending: false })
        .limit(500),
      supabase.rpc("sold_activity_weekly", { p_weeks: ACTIVITY_WEEKS }),
    ]);

    if (listingsResult.error) {
      return {
        rows: [],
        activity: [],
        generatedAt: new Date().toISOString(),
        error: listingsResult.error.message,
      };
    }

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
      rows: (listingsResult.data ?? []) as SoldRow[],
      activity,
      generatedAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      rows: [],
      activity: [],
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown data error",
    };
  }
}

export const getSoldPageData = unstable_cache(
  fetchSoldPageData,
  ["sold-page-data-v2"],
  { revalidate: 300, tags: ["sold-data"] },
);
