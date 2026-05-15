// Per-seller daily new-listing counts. Used by /sellers (the featured
// cards and the table) so each seller surfaces a real 30-day shape
// instead of just a static inventory count.
import { createClient } from "@/lib/supabase/server";

const DAY_MS = 86_400_000;
export const ACTIVITY_WINDOW_DAYS = 30;

type Row = {
  seller_id: string | null;
  first_seen_at: string | null;
};

/**
 * Returns a Map keyed by seller_id with an array of
 * ACTIVITY_WINDOW_DAYS daily counts (oldest first) — how many of that
 * seller's listings were first observed on each of the last 30 days.
 *
 * `targetSellerIds` narrows the query so we don't churn through every
 * listing in the catalog when we only need the top-N. Pass null to
 * include every seller.
 */
export async function getSellerDailyActivity(
  targetSellerIds: ReadonlyArray<string> | null = null,
): Promise<Map<string, number[]>> {
  const supabase = createClient();
  const sinceMs = Date.now() - ACTIVITY_WINDOW_DAYS * DAY_MS;
  const since = new Date(sinceMs).toISOString();

  let q = supabase
    .from("market_listings")
    .select("seller_id, first_seen_at")
    .gte("first_seen_at", since)
    .not("seller_id", "is", null)
    .limit(20000);

  if (targetSellerIds && targetSellerIds.length > 0) {
    q = q.in("seller_id", targetSellerIds as string[]);
  }

  const { data } = await q;
  const rows = (data ?? []) as Row[];
  const result = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.seller_id || !r.first_seen_at) continue;
    const t = Date.parse(r.first_seen_at);
    if (!Number.isFinite(t)) continue;
    const idx = Math.floor((t - sinceMs) / DAY_MS);
    if (idx < 0 || idx >= ACTIVITY_WINDOW_DAYS) continue;
    const arr =
      result.get(r.seller_id) ??
      Array.from({ length: ACTIVITY_WINDOW_DAYS }, () => 0);
    arr[idx]! += 1;
    result.set(r.seller_id, arr);
  }
  return result;
}
