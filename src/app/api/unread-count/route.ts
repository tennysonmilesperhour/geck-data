// Per-user unread notification count for geck-inspect's Market Intelligence
// launcher in the topbar.
//
//   GET /api/unread-count?email=<user_email>
//   → 200 { count, email, as_of }
//
// The button in geck-inspect polls this every 2 min and renders a badge
// when `count > 0`. Any non-2xx response, network error, or malformed JSON
// is mapped to "no badge" on the caller side — so this endpoint can return
// a structurally-valid zero while the underlying unread-alerts model is
// still being built out, without any visible breakage in geck-inspect.
//
// Current behaviour: we don't yet have a per-user "unread" signal wired up
// in this app (alert_matches exists but isn't keyed by email cheaply), so
// we always return 0. When we do, this is the single place to plug it in —
// look up profiles.id by email, count `alert_matches` rows for that user
// where `seen_at is null`, cap at a sane number.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Origins we actively allow. Anything else gets the default origin back
// so the browser blocks the read without CORS throwing in the app.
const ALLOWED_ORIGINS = new Set([
  "https://geckinspect.com",
  "https://www.geckinspect.com",
  "https://geckintellect.geckinspect.com",
]);
const DEFAULT_ORIGIN = "https://geckinspect.com";

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed =
    ALLOWED_ORIGINS.has(origin) ||
    // Vercel preview deployments + local dev get through too.
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : DEFAULT_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  return NextResponse.json(
    { count: 0, email, as_of: new Date().toISOString() },
    { headers: corsHeaders(req) },
  );
}
