// Server-side data fetch for the landing-page scrollytelling section.
// Five panels share one trip to the DB so the page paint stays single-pass.

import { createClient } from "@/lib/supabase/server";

export type ScrollyListing = {
  id: string;
  price: number | null;
  price_usd_equivalent: number | null;
  maturity: string | null;
  sex: string | null;
  cached_traits: string | null;
  norm_traits: string | null;
  first_seen_at: string | null;
};

export type RegionalCell = {
  combo_name: string;
  region: string;
  n: number;
  median_sold: number | null;
  median_ask: number | null;
  confidence_score: number;
};

export type ScrollytellingData = {
  listings: ScrollyListing[];
  days_to_sell: number[];
  regional: RegionalCell[];
  total_listings_returned: number;
};

const LIST_LIMIT = 5000;
const WINDOW_DAYS = 365;

export async function getScrollytellingData(): Promise<ScrollytellingData> {
  const supabase = createClient();

  const [listingsQ, regionalQ, soldEventsQ] = await Promise.all([
    supabase
      .from("market_listings")
      .select(
        "id, price, price_usd_equivalent, maturity, sex, cached_traits, norm_traits, first_seen_at",
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

  return {
    listings,
    days_to_sell,
    regional,
    total_listings_returned: listings.length,
  };
}
