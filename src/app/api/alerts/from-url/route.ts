// Save the current filter state of /sellers, /trends, etc. as a new alert.
//
//   POST /api/alerts/from-url
//     body: { name: string, url: string }
//
// Reads the URL's query string and translates the supported filter params
// into the alerts.query jsonb shape that lib/alerts/matcher.ts understands.
// The translator lives in lib/alerts/from-url.ts so it can be unit-tested
// without importing this route file (Next.js routes can't export anything
// that isn't an HTTP method handler).
//
// Auth: requires a session; the alert is owned by the user.

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { queryFromUrl } from "@/lib/alerts/from-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supa = createServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { name?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const url = (body.url ?? "").trim();
  if (!name || !url) {
    return NextResponse.json({ error: "name and url required" }, { status: 400 });
  }
  const query = queryFromUrl(url);
  if (Object.keys(query).length === 0) {
    return NextResponse.json(
      { error: "could not derive any filter from url" },
      { status: 400 },
    );
  }

  // alerts table has owner-scoped INSERT with auth.uid() = owner_id.
  const { data, error } = await supa
    .from("alerts")
    .insert({
      owner_id: user.id,
      name,
      query,
      active: true,
    })
    .select("id, query")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ alert: data });
}
