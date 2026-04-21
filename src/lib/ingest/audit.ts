// One row per /api/ingest request, written to public.ingest_audit using
// the service-role admin client. Called by the route handler at the end
// of each POST (JSON or multipart) — swallows its own errors so a failure
// to log can never break the ingest path itself.
//
// IPs are hashed before storage. The salt rotates daily (UTC) so the same
// caller produces different hashes across days — good enough to dedupe a
// burst within a day without leaving raw IPs at rest.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditRow = {
  source_tag: string | null;
  content_type: string | null;
  event_count: number;
  ok_count: number;
  failed_count: number;
  duration_ms: number;
  status_code: number;
  error_summary: string | null;
  event_types: string[] | null;
  file_count: number | null;
  client_ip_hash: string | null;
  user_agent: string | null;
};

export function hashClientIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = `geck-ingest-${new Date().toISOString().slice(0, 10)}`;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export async function recordIngestAudit(
  admin: SupabaseClient,
  row: AuditRow,
): Promise<void> {
  try {
    const { error } = await admin.from("ingest_audit").insert(row);
    if (error) console.error("[ingest_audit] insert failed:", error.message);
  } catch (e) {
    console.error("[ingest_audit] threw:", e);
  }
}

// Turn a list of event envelopes into a deduped list of types for the
// audit row. Bounded at ~20 items so one malicious caller can't send a
// 10 000-element array.
export function distinctEventTypes(events: Array<{ type: string }>): string[] {
  const s = new Set<string>();
  for (const e of events) {
    if (typeof e?.type === "string") s.add(e.type);
    if (s.size >= 20) break;
  }
  return Array.from(s);
}
