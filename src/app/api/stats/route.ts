// Live counts for the extension popup + dashboard ping.
// GET https://geck-data.vercel.app/api/stats
//
// Public (no auth) — reads only, returns only counts. Uses the service-role
// key to count, which bypasses RLS and avoids exposing row content.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

type Admin = ReturnType<typeof createAdminClient>;

async function countOrNull(
  admin: Admin,
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter?: (q: any) => any,
): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base: any = admin.from(table).select("*", { count: "exact", head: true });
  const q = filter ? filter(base) : base;
  const { count, error } = await q;
  if (error) return null;
  return count ?? 0;
}

export async function GET() {
  const admin = createAdminClient();
  const [listings, animals, sold, sellers, images, lastEvent] = await Promise.all([
    countOrNull(admin, "market_listings"),
    countOrNull(admin, "market_listings", (q) => q.eq("kind", "animal")),
    countOrNull(admin, "market_listings", (q) => q.eq("kind", "sold")),
    countOrNull(admin, "market_sellers"),
    countOrNull(admin, "listing_images"),
    admin
      .from("ingest_events")
      .select("kind, received, written, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r) => r.data ?? null),
  ]);

  return json({
    listings,
    animals,
    sold,
    sellers,
    images,
    last_event: lastEvent,
    as_of: new Date().toISOString(),
  });
}
