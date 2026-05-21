// Public cross-platform arbitrage feed.
//
// Reads v_cross_platform_arbitrage_pairs (migration 0029) — pairs of
// MorphMarket + cross-platform listings that share an image pHash. The
// view is empty until the pHash worker populates phash columns; we
// gracefully return [] in that case.
//
// Query: ?min_pct=20 to filter by absolute price delta percentage.
//
// Cached for 10 minutes — these pairs only refresh when a new image
// lands or a price changes.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PairRow = {
  listing_id: string;
  cross_platform: string;
  cross_external_id: string;
  cross_listing_uuid: string;
  mm_price_usd: number | null;
  xpl_price_usd: number | null;
  pct_delta: number | null;
  abs_delta_usd: number | null;
  mm_url: string | null;
  xpl_url: string | null;
};

const headers = {
  "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
  "Access-Control-Allow-Origin": "*",
};

export async function GET(req: NextRequest) {
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "admin" }, { status: 500 });
  }
  const url = new URL(req.url);
  const minPct = Number(url.searchParams.get("min_pct") ?? "10");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);

  const { data, error } = await admin
    .from("v_cross_platform_arbitrage_pairs")
    .select("*")
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }
  const rows = ((data ?? []) as PairRow[]).filter(
    (r) => r.pct_delta != null && Math.abs(r.pct_delta) >= minPct,
  );
  rows.sort((a, b) => Math.abs(b.pct_delta ?? 0) - Math.abs(a.pct_delta ?? 0));

  return NextResponse.json(
    {
      pairs: rows,
      count: rows.length,
      min_pct: minPct,
      generated_at: new Date().toISOString(),
    },
    { headers },
  );
}
