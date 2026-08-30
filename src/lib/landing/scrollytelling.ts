// Server-side data fetch for the landing-page scrollytelling section.
// Five panels share one trip to the DB so the page paint stays single-pass.

import { createClient } from "@/lib/supabase/server";
import type {
  RegionalCell,
  ScrollyListing,
  ScrollytellingData,
} from "./scrolly-types";
export type {
  CurrencyShare,
  RegionCoverage,
  RegionalCell,
  ScrollyListing,
  ScrollytellingData,
} from "./scrolly-types";
export { MIN_REGION_LISTINGS } from "./scrolly-types";

const LIST_LIMIT = 5000;
const WINDOW_DAYS = 365;
const SOLD_FRESH_DAYS = 30;

export async function getScrollytellingData(): Promise<ScrollytellingData> {
  const supabase = createClient();

  const [listingsQ, regionalQ, soldEventsQ, newestSoldQ] = await Promise.all([
    supabase
      .from("market_listings")
      .select(
        "id, price, price_usd_equivalent, maturity, sex, cached_traits, norm_traits, first_seen_at, first_listed_at",
      )
      .not("price_usd_equivalent", "is", null)
      .limit(LIST_LIMIT),
    supabase.rpc("v_regional_heatmap", { window_days: WINDOW_DAYS }),
    supabase
      .from("listing_status_events")
      .select("days_since_first_seen")
      .eq("status", "sold")
      .not("days_since_first_seen", "is", null)
      .limit(2000),
    supabase
      .from("listing_status_events")
      .select("observed_at")
      .eq("status", "sold")
      .order("observed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const listings = (listingsQ.data ?? []) as ScrollyListing[];

  const regional = (regionalQ.data ?? []).map(
    (r: {
      combo_name: string;
      region: string;
      n: number;
      median_sold: number | string | null;
      median_ask: number | string | null;
      confidence_score: number;
    }) => ({
      combo_name: r.combo_name,
      region: r.region,
      n: r.n,
      median_sold:
        r.median_sold != null && r.median_sold !== ""
          ? Number(r.median_sold)
          : null,
      median_ask:
        r.median_ask != null && r.median_ask !== ""
          ? Number(r.median_ask)
          : null,
      confidence_score: r.confidence_score ?? 0,
    }),
  ) as RegionalCell[];

  const days_to_sell = (soldEventsQ.data ?? [])
    .map((r) => r.days_since_first_seen as number | null)
    .filter((d): d is number => typeof d === "number" && d >= 0 && d < 365);

  const newest_sold_at =
    (newestSoldQ.data as { observed_at: string | null } | null)?.observed_at ??
    null;
  const soldAgeDays = newest_sold_at
    ? (Date.now() - Date.parse(newest_sold_at)) / 86_400_000
    : Infinity;
  const sold_stream_usable =
    Number.isFinite(soldAgeDays) && soldAgeDays <= SOLD_FRESH_DAYS;

  // Currency mix lives on public.listings, which the anon landing client
  // cannot read. The public heatmap is still ~USD; copy states that
  // without inventing a percentage we cannot fetch on this path.
  const currency: ScrollytellingData["currency"] = [];

  const regionN = new Map<string, number>();
  for (const cell of regional) {
    regionN.set(cell.region, (regionN.get(cell.region) ?? 0) + cell.n);
  }
  const region_coverage = [...regionN.entries()]
    .map(([region, n_listings]) => ({ region, n_listings }))
    .sort((a, b) => b.n_listings - a.n_listings);

  return {
    listings,
    days_to_sell,
    regional,
    total_listings_returned: listings.length,
    currency,
    region_coverage,
    newest_sold_at,
    sold_stream_usable,
  };
}
