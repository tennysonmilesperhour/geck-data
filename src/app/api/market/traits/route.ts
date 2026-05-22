// Public trait vocabulary endpoint.
//
//   GET /api/market/traits
//
// Returns the deduped list of trait labels observed in cached_traits,
// each with its listing count. Powers the /whats-it-worth autocomplete
// so users pick from real traits in the database rather than a
// hardcoded list of 12 canonical combos.
//
// Cached at the edge for 1 hour — the vocabulary moves slowly.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
  "Access-Control-Allow-Origin": "*",
};

export async function GET(_req: NextRequest) {
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "admin" }, { status: 500, headers });
  }
  const { data, error } = await admin
    .from("v_trait_vocabulary")
    .select("trait, listing_count")
    .order("listing_count", { ascending: false })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }
  return NextResponse.json(
    {
      traits: data ?? [],
      count: data?.length ?? 0,
      generated_at: new Date().toISOString(),
    },
    { headers },
  );
}
