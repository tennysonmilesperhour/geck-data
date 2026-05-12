// Reusable data fetchers for the geck-data admin pages.
//
// Every function in here returns a small typed object that the page
// components can render directly. We keep them server-only so the
// service-role queries never leak to the browser.
//
// These read from the geck-data schema tables (listings, scrape_runs,
// listings_history, morphs) plus two precomputed views (morph_price_stats,
// seller_stats). They do not touch any market_* table.

import "server-only";
import { createClient as createServerClient } from "@/lib/supabase/server";

export type ScrapeRun = {
  id: number;
  scrape_type: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_attempted: number | null;
  records_succeeded: number | null;
  records_failed: number | null;
  triggered_by: string | null;
  error_message: string | null;
};

export type Listing = {
  listing_id: string;
  name: string | null;
  price: number | null;
  currency: string | null;
  sex: string | null;
  weight: string | null;
  weight_grams: number | null;
  maturity: string | null;
  seller_name: string | null;
  trait_array: string[] | null;
  primary_image_url: string | null;
  listing_url: string;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
};

export type MorphPriceStat = {
  trait_name: string;
  listing_count: number;
  avg_price: number | null;
  median_price: number | null;
  min_price: number | null;
  max_price: number | null;
  p25_price: number | null;
  p75_price: number | null;
};

export type SellerStat = {
  seller_name: string;
  active_listings: number;
  avg_price: number | null;
  first_listing_seen: string | null;
  last_active: string | null;
};

export type AdminHomeStats = {
  active_listings: number;
  avg_price: number | null;
  unique_sellers: number;
  most_recent_run: ScrapeRun | null;
};

export async function getAdminHomeStats(): Promise<AdminHomeStats> {
  const supabase = createServerClient();

  const [activeCountRes, sellerCountRes, priceRes, recentRunRes] =
    await Promise.all([
      supabase
        .from("listings")
        .select("listing_id", { count: "exact", head: true })
        .eq("is_active", true),
      // Distinct seller_name count: select distinct then count on the client.
      // For ~6k listings this is fine; if it grows we can swap to a view.
      supabase
        .from("listings")
        .select("seller_name")
        .eq("is_active", true)
        .not("seller_name", "is", null),
      supabase
        .from("listings")
        .select("price")
        .eq("is_active", true)
        .not("price", "is", null),
      supabase
        .from("scrape_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const active = activeCountRes.count ?? 0;

  const uniqueSellers = new Set<string>();
  for (const row of sellerCountRes.data ?? []) {
    if (row.seller_name) uniqueSellers.add(row.seller_name);
  }

  const prices = (priceRes.data ?? [])
    .map((r) => Number(r.price))
    .filter((n) => Number.isFinite(n));
  const avg =
    prices.length === 0
      ? null
      : prices.reduce((a, b) => a + b, 0) / prices.length;

  return {
    active_listings: active,
    avg_price: avg,
    unique_sellers: uniqueSellers.size,
    most_recent_run: (recentRunRes.data ?? null) as ScrapeRun | null,
  };
}

export async function getRecentScrapeRuns(limit = 10): Promise<ScrapeRun[]> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("scrape_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ScrapeRun[];
}

export async function getAllScrapeRuns(
  page = 1,
  pageSize = 50,
): Promise<{ rows: ScrapeRun[]; total: number }> {
  const supabase = createServerClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count } = await supabase
    .from("scrape_runs")
    .select("*", { count: "exact" })
    .order("started_at", { ascending: false })
    .range(from, to);
  return { rows: (data ?? []) as ScrapeRun[], total: count ?? 0 };
}

export async function getListings(
  page = 1,
  pageSize = 50,
): Promise<{ rows: Listing[]; total: number }> {
  const supabase = createServerClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count } = await supabase
    .from("listings")
    .select(
      "listing_id,name,price,currency,sex,weight,weight_grams,maturity,seller_name,trait_array,primary_image_url,listing_url,first_seen_at,last_seen_at,is_active",
      { count: "exact" },
    )
    .order("last_seen_at", { ascending: false })
    .range(from, to);
  return { rows: (data ?? []) as Listing[], total: count ?? 0 };
}

export async function getListingFull(listingId: string) {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("listings")
    .select("*")
    .eq("listing_id", listingId)
    .maybeSingle();
  return data;
}

export async function getMorphPriceStats(): Promise<MorphPriceStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("morph_price_stats")
    .select("*")
    .order("listing_count", { ascending: false })
    .limit(500);
  if (error) {
    console.warn("[geck-data queries] morph_price_stats:", error.message);
    return [];
  }
  return (data ?? []) as MorphPriceStat[];
}

export async function getSellerStats(): Promise<SellerStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("seller_stats")
    .select("*")
    .order("active_listings", { ascending: false })
    .limit(500);
  if (error) {
    console.warn("[geck-data queries] seller_stats:", error.message);
    return [];
  }
  return (data ?? []) as SellerStat[];
}
