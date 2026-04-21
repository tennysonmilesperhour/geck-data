// Per-client rate limit for POST /api/ingest.
//
// Threat model: the INGEST_API_KEY is shipped inside the browser extension
// bundle, so anyone who installs the .crx can read it and begin POSTing
// arbitrary events. Defensive depth against that ends at the network layer
// (Vercel) and at schema validation (events.ts/legacyAdapter.ts). This
// module adds a middle layer — a per-client-IP-hash rate limit — so even a
// leaked key can't pollute the DB faster than a human would use it.
//
// Storage: we reuse ingest_audit (migration 0004) as the rate-limit store.
// Every POST already writes one row there. To enforce a limit we just
// count recent rows for the same client_ip_hash. No new table, no new
// infra. A dedicated index on (client_ip_hash, received_at desc) keeps
// this O(recent_rows_for_this_ip) — see migration 0005.
//
// Fail-open when we can't identify the caller (no IP headers present, as
// happens in some Vercel health-check paths and in local dev).
//
// Tunable via env:
//   INGEST_RATE_PER_MIN   default 300
//   INGEST_RATE_PER_HOUR  default 5000
//
// These are generous for live extension use (a typical MorphMarket page
// visit triggers 1–2 POSTs; 300/min = 5/sec). Tighten them if you see
// ingest_audit filling up with unexpected client hashes.

import type { SupabaseClient } from "@supabase/supabase-js";

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number; reason: string };

function limit(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function checkRateLimit(
  admin: SupabaseClient,
  clientIpHash: string | null,
): Promise<RateLimitResult> {
  if (!clientIpHash) return { allowed: true };

  const perMin = limit("INGEST_RATE_PER_MIN", 300);
  const perHour = limit("INGEST_RATE_PER_HOUR", 5000);

  const now = Date.now();
  const oneMinAgo = new Date(now - 60_000).toISOString();
  const oneHourAgo = new Date(now - 3_600_000).toISOString();

  const [minRes, hourRes] = await Promise.all([
    admin
      .from("ingest_audit")
      .select("id", { count: "exact", head: true })
      .eq("client_ip_hash", clientIpHash)
      .gte("received_at", oneMinAgo),
    admin
      .from("ingest_audit")
      .select("id", { count: "exact", head: true })
      .eq("client_ip_hash", clientIpHash)
      .gte("received_at", oneHourAgo),
  ]);

  // If either query errored (table missing, RLS, etc) don't block real
  // traffic. Visibility into the error arrives via the audit row for the
  // request itself.
  if (minRes.error || hourRes.error) return { allowed: true };

  const minCount = minRes.count ?? 0;
  const hourCount = hourRes.count ?? 0;

  if (minCount >= perMin) {
    return {
      allowed: false,
      retryAfterSec: 60,
      reason: `rate limit: ${minCount}/${perMin} req/min`,
    };
  }
  if (hourCount >= perHour) {
    return {
      allowed: false,
      retryAfterSec: 3600,
      reason: `rate limit: ${hourCount}/${perHour} req/hour`,
    };
  }
  return { allowed: true };
}
