import "server-only";

import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";

async function fetchLatestMarketSeenAt(): Promise<string | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("market_listings")
    .select("last_seen_at")
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as { last_seen_at: string | null } | null)?.last_seen_at ?? null;
}

export const getLatestMarketSeenAt = unstable_cache(
  fetchLatestMarketSeenAt,
  ["latest-market-seen-at-v1"],
  { revalidate: 300, tags: ["market-freshness"] },
);
