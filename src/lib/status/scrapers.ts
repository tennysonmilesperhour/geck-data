// Per-scrape_type health derived from the scrape_runs table.
//
// Why this exists: the June 2026 outage. /api/status.json only watched
// the extension ingest stream, so four weeks of every scraper failing
// (Decodo quota exhausted, runs stuck on 'running' until the workflow
// timeout) never tripped any monitor. This module gives the status
// endpoint and the /status page one shared view of "when did each
// scraper last actually deliver rows".
//
// A run counts as healthy when its status is success or partial AND it
// either delivered rows or legitimately had nothing to do
// (records_attempted = 0, e.g. a details pass with an empty queue).
// The 429 death spiral produced 'partial' runs with 142 attempted and
// 0 succeeded; those must NOT count as healthy.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ScraperHealth = {
  scrapeType: string;
  label: string;
  cadence: string;
  thresholdHours: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastHealthyAt: string | null;
  hoursSinceHealthy: number | null;
  state: "ok" | "down";
  lastError: string | null;
};

// How long each scrape_type may go without a healthy run before it
// reports down. Listings runs hourly (36h = lots of slack); the others
// run weekly (8.5 days = one missed week plus slack).
const EXPECTED: Array<{
  scrapeType: string;
  label: string;
  cadence: string;
  thresholdHours: number;
}> = [
  { scrapeType: "listings", label: "Listings grid walk", cadence: "hourly", thresholdHours: 36 },
  { scrapeType: "details", label: "Listing detail re-scrape", cadence: "weekly", thresholdHours: 204 },
  { scrapeType: "sellers", label: "Seller store pages", cadence: "weekly", thresholdHours: 204 },
  { scrapeType: "images", label: "Primary image download", cadence: "weekly", thresholdHours: 204 },
];

type RunRow = {
  scrape_type: string;
  status: string | null;
  started_at: string | null;
  records_attempted: number | null;
  records_succeeded: number | null;
  error_message: string | null;
};

function isHealthyRun(r: RunRow): boolean {
  if (r.status !== "success" && r.status !== "partial") return false;
  const attempted = r.records_attempted ?? 0;
  const succeeded = r.records_succeeded ?? 0;
  return succeeded > 0 || attempted === 0;
}

export async function fetchScraperHealth(
  admin: SupabaseClient,
): Promise<ScraperHealth[]> {
  // 400 recent rows comfortably covers a week of hourly listings runs
  // plus the weekly jobs, which is all the freshness math needs.
  const { data, error } = await admin
    .from("scrape_runs")
    .select(
      "scrape_type,status,started_at,records_attempted,records_succeeded,error_message",
    )
    .order("started_at", { ascending: false })
    .limit(400);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as RunRow[];
  const now = Date.now();

  return EXPECTED.map((exp) => {
    const mine = rows.filter((r) => r.scrape_type === exp.scrapeType);
    const lastRun = mine[0] ?? null;
    const lastHealthy = mine.find(isHealthyRun) ?? null;
    const hoursSinceHealthy = lastHealthy?.started_at
      ? Math.round((now - Date.parse(lastHealthy.started_at)) / 3_600_000)
      : null;
    const lastFailed = mine.find(
      (r) => r.status === "failed" && r.error_message,
    );
    return {
      scrapeType: exp.scrapeType,
      label: exp.label,
      cadence: exp.cadence,
      thresholdHours: exp.thresholdHours,
      lastRunAt: lastRun?.started_at ?? null,
      lastRunStatus: lastRun?.status ?? null,
      lastHealthyAt: lastHealthy?.started_at ?? null,
      hoursSinceHealthy,
      state:
        hoursSinceHealthy != null && hoursSinceHealthy <= exp.thresholdHours
          ? "ok"
          : "down",
      lastError: lastFailed?.error_message ?? null,
    };
  });
}
