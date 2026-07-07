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
//     "ingest": { ... extension event stream freshness ... },
//     "scrapers": [ ... per-scrape_type freshness from scrape_runs ... ],
//     "data_age": {
//       "market_listings_max_last_seen": "...",
//       "minutes_stale": 8
//     }
//   }
//
// Overall status semantics (revised after the June 2026 outage, when a
// completely dead scraper pipeline reported "ok" because this endpoint
// only watched the extension stream):
//   down:     no data inflow at all - the newest market_listings row is
//             older than 48 hours (or missing).
//   degraded: any single stream is unhealthy - extension silent > 6h,
//             ingest ok_rate < 0.9, any scraper past its freshness
//             threshold, or data older than 60 minutes.
//   ok:       everything above passes.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchScraperHealth, type ScraperHealth } from "@/lib/status/scrapers";

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

  const [{ data: health }, { data: latestListing }, scrapers] =
    await Promise.all([
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
      fetchScraperHealth(admin).catch((): ScraperHealth[] => []),
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

  const extensionSilent = minutesSinceLast == null || minutesSinceLast > 360;
  const anyScraperDown = scrapers.some((s) => s.state === "down");

  let status: "ok" | "degraded" | "down" = "ok";
  if (minutesStale == null || minutesStale > 48 * 60) status = "down";
  else if (
    extensionSilent ||
    anyScraperDown ||
    (okRate != null && okRate < 0.9) ||
    minutesStale > 60
  ) {
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
      scrapers: scrapers.map((s) => ({
        scrape_type: s.scrapeType,
        cadence: s.cadence,
        state: s.state,
        last_run_at: s.lastRunAt,
        last_run_status: s.lastRunStatus,
        last_healthy_at: s.lastHealthyAt,
        hours_since_healthy: s.hoursSinceHealthy,
        threshold_hours: s.thresholdHours,
        last_error: s.lastError,
      })),
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
