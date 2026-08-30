// Types and constants shared by the landing scrollytelling fetch and the
// client panels. Kept free of server imports so client charts can load them.

export type ScrollyListing = {
  id: string;
  price: number | null;
  price_usd_equivalent: number | null;
  maturity: string | null;
  sex: string | null;
  cached_traits: string | null;
  norm_traits: string | null;
  first_seen_at: string | null;
  first_listed_at: string | null;
};

export type RegionalCell = {
  combo_name: string;
  region: string;
  n: number;
  median_sold: number | null;
  median_ask: number | null;
  confidence_score: number;
};

export type CurrencyShare = {
  currency: string;
  n: number;
};

export type RegionCoverage = {
  region: string;
  n_listings: number;
};

export type ScrollytellingData = {
  listings: ScrollyListing[];
  days_to_sell: number[];
  regional: RegionalCell[];
  total_listings_returned: number;
  currency: CurrencyShare[];
  region_coverage: RegionCoverage[];
  newest_sold_at: string | null;
  sold_stream_usable: boolean;
};

export const MIN_REGION_LISTINGS = 5;
