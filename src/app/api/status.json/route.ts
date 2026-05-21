// Machine-readable system health endpoint.
//
//   GET /api/status.json
//
// Polled by external uptime monitors (UptimeRobot, BetterStack, etc.) and
// by the /status page itself. Public (no auth). Returns a small JSON
// envelope with traffic-light fields rather than raw row dumps:
//
//   {
//     "status": "ok" | "degraded" | "down",
//     "ingest": {
//       "last_event_at": "...",
//       "minutes_since_last_event": 3,
//       "ok_rate_24h": 0.98,
//       "p95_duration_ms": 240
//     },
//     "data_age": {
//       "market_listings_max_last_seen": "...",
//       "minutes_stale": 8
//     }
//   }
//
// "down" if no successful ingest in 6 hours; "degraded" if ok_rate < 0.9
// or stale_minutes > 60.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HealthRow = {
  total_requests: number | null;
  ok_requests: number | null;
  error_requests: number | null;
  total_events: number | null;
  events_ok: number | null;
  events_failed: number | null;
  p50_duration_ms: number | null;
  p95_duration_ms: number | null;
  last_ingest_at: string | null;
};

export async function GET(_req: NextRequest) {
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ status: "down", error: e instanceof Error ? e.message : "admin" }, { status: 500 });
  }

  const [{ data: health }, { data: latestListing }] = await Promise.all([
    admin
      .from("v_ingest_health_24h")
      .select("*")
      .maybeSingle()
      .then((r) => ({ data: r.data as HealthRow | null })),
    admin
      .from("market_listings")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
      .then((r) => ({ data: r.data as { last_seen_at: string | null } | null })),
  ]);

  const now = Date.now();
  const minutesSinceLast = health?.last_ingest_at
    ? Math.round((now - Date.parse(health.last_ingest_at)) / 60_000)
    : null;
  const minutesStale = latestListing?.last_seen_at
    ? Math.round((now - Date.parse(latestListing.last_seen_at)) / 60_000)
    : null;
  const okRate =
    health?.total_requests && health.total_requests > 0
      ? (health.ok_requests ?? 0) / health.total_requests
      : null;

  let status: "ok" | "degraded" | "down" = "ok";
  if (minutesSinceLast == null || minutesSinceLast > 360) status = "down";
  else if ((okRate != null && okRate < 0.9) || (minutesStale != null && minutesStale > 60)) {
    status = "degraded";
  }

  return NextResponse.json(
    {
      status,
      generated_at: new Date().toISOString(),
      ingest: {
        last_event_at: health?.last_ingest_at ?? null,
        minutes_since_last_event: minutesSinceLast,
        total_requests_24h: health?.total_requests ?? 0,
        ok_rate_24h: okRate,
        p50_duration_ms: health?.p50_duration_ms ?? null,
        p95_duration_ms: health?.p95_duration_ms ?? null,
        events_ok_24h: health?.events_ok ?? 0,
        events_failed_24h: health?.events_failed ?? 0,
      },
      data_age: {
        market_listings_max_last_seen: latestListing?.last_seen_at ?? null,
        minutes_stale: minutesStale,
      },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
