// Machine-to-machine ingest endpoint for the browser extension.
//
// Auth: Authorization: Bearer <INGEST_API_KEY> (constant-time compared).
//
// Two input shapes are accepted, chosen by Content-Type:
//
//   1) application/json   { events: [{ type, payload, occurred_at?, source? }] }
//      Real-time event stream from the extension. Handlers in lib/ingest/events
//      fan out to the right tables (market_listings, price_history, price_drops,
//      listing_status_events, auction_results, seller_snapshots, show_mentions,
//      cross_platform_listings, alert_matches).
//
//   2) multipart/form-data  files[]=<Blob>
//      Bulk backfill. .db/.sqlite → parseSqlite; image/* → listing-images;
//      .csv/.tsv → raw-uploads. Same logic as /api/upload but no session auth.
//
// All writes use the service role key.
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseMorphmarketDb, upsertBatched } from "@/lib/ingest/parseSqlite";
import { handleEvent, parseEnvelopes } from "@/lib/ingest/events";
import {
  distinctEventTypes,
  hashClientIp,
  recordIngestAudit,
  type AuditRow,
} from "@/lib/ingest/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type FileResult = {
  file: string;
  kind: "db" | "image" | "csv" | "unknown";
  ok: boolean;
  detail: string;
};

function classify(name: string, mime: string): FileResult["kind"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".db") || lower.endsWith(".sqlite")) return "db";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "csv";
  if (mime.startsWith("image/")) return "image";
  return "unknown";
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return false;

  // Accept two equivalent formats so the extension and other clients don't
  // have to agree on a header name:
  //   Authorization: Bearer <token>
  //   x-api-key: <token>
  const auth = req.headers.get("authorization") ?? "";
  const fromBearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const fromApiKey = req.headers.get("x-api-key") ?? "";
  const presented = fromBearer || fromApiKey;
  if (!presented) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// CORS — content scripts running on https://www.morphmarket.com are the
// primary cross-origin caller. Extension service workers (chrome-extension://)
// fetch with host_permissions so CORS doesn't apply to them, but we still
// echo their origin back in case a future caller lacks the permission.
const ALLOWED_ORIGINS = new Set(["https://www.morphmarket.com"]);
const DEFAULT_ORIGIN = "https://www.morphmarket.com";

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed =
    ALLOWED_ORIGINS.has(origin) || origin.startsWith("chrome-extension://");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : DEFAULT_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-API-Key, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withCors(res: NextResponse, req: NextRequest): NextResponse {
  for (const [k, v] of Object.entries(corsHeaders(req))) {
    res.headers.set(k, v);
  }
  return res;
}

// Preflight. Returns 200 immediately with the CORS headers so the browser
// allows the subsequent POST / GET with x-api-key + application/json.
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 200, headers: corsHeaders(req) });
}

// GET — Bearer-gated diagnostic. Returns per-table row counts plus a check
// that the touch_listing_seen RPC from migration 0002 registered, so we can
// tell end-to-end whether the extension's events are landing in Supabase
// (and, if they are not, which specific piece is broken).
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return withCors(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      req,
    );
  }
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return withCors(
      NextResponse.json({ error: `admin client: ${msg}` }, { status: 500 }),
      req,
    );
  }

  const tables = [
    "market_listings",
    "market_sellers",
    "price_history",
    "price_drops",
    "listing_status_events",
    "auction_results",
    "seller_snapshots",
    "show_mentions",
    "cross_platform_listings",
    "alerts",
    "alert_matches",
  ];
  const counts: Record<string, number | string> = {};
  for (const t of tables) {
    const { count, error } = await admin
      .from(t)
      .select("*", { count: "exact", head: true });
    counts[t] = error ? `error: ${error.message}` : (count ?? 0);
  }

  // Probe the RPC. A missing function surfaces as a PostgREST error; a
  // harmless "no matching listing" result means the function exists.
  let touchRpc: string;
  try {
    const { error } = await admin.rpc("touch_listing_seen", {
      p_id: "__diag_nonexistent__",
      p_observed: new Date().toISOString(),
    });
    touchRpc = error ? `error: ${error.message}` : "ok";
  } catch (e) {
    touchRpc = `threw: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Most recent activity timestamps per stream — quick "is anything flowing?"
  // check without pulling any rows.
  const recency: Record<string, string | null | "error"> = {};
  const recencyTargets: Array<[string, string]> = [
    ["market_listings", "last_seen_at"],
    ["price_drops", "observed_at"],
    ["listing_status_events", "observed_at"],
    ["show_mentions", "observed_at"],
    ["seller_snapshots", "observed_at"],
    ["cross_platform_listings", "last_seen_at"],
    ["alert_matches", "matched_at"],
  ];
  for (const [table, col] of recencyTargets) {
    const { data, error } = await admin
      .from(table)
      .select(col)
      .order(col, { ascending: false, nullsFirst: false })
      .limit(1);
    if (error) {
      recency[table] = "error";
    } else {
      const row = (data as unknown as Record<string, string | null>[] | null)?.[0];
      recency[table] = row?.[col] ?? null;
    }
  }

  return withCors(
    NextResponse.json({ counts, touchRpc, mostRecent: recency }),
    req,
  );
}

export async function POST(req: NextRequest) {
  // Audit scaffolding. We build the row as the request progresses and flush
  // it in `finally` so every path (success, validation error, fatal) leaves
  // a trace in ingest_audit. Audit failures never propagate.
  const t0 = Date.now();
  const audit: AuditRow = {
    source_tag: req.headers.get("x-ingest-source"),
    content_type: req.headers.get("content-type"),
    event_count: 0,
    ok_count: 0,
    failed_count: 0,
    duration_ms: 0,
    status_code: 500,
    error_summary: null,
    event_types: null,
    file_count: null,
    client_ip_hash: hashClientIp(clientIp(req)),
    user_agent: req.headers.get("user-agent"),
  };

  let response: NextResponse;
  try {
    response = await handle(req, audit);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/ingest] fatal:", e);
    audit.error_summary = msg.slice(0, 500);
    audit.status_code = 500;
    response = withCors(
      NextResponse.json({ error: msg }, { status: 500 }),
      req,
    );
  }

  audit.status_code = response.status;
  audit.duration_ms = Date.now() - t0;
  // Log with the admin client; swallow any failure (see recordIngestAudit).
  try {
    await recordIngestAudit(createAdminClient(), audit);
  } catch {
    // swallow
  }
  return response;
}

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

async function handle(req: NextRequest, audit: AuditRow): Promise<NextResponse> {
  if (!authorized(req)) {
    audit.error_summary = "unauthorized";
    return withCors(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      req,
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  const admin = createAdminClient();

  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      audit.error_summary = "invalid JSON body";
      return withCors(
        NextResponse.json({ error: "invalid JSON body" }, { status: 400 }),
        req,
      );
    }
    const envelopes = parseEnvelopes(body);
    audit.event_count = envelopes.length;
    audit.event_types = distinctEventTypes(envelopes);
    if (envelopes.length === 0) {
      audit.error_summary = "no valid events in body";
      return withCors(
        NextResponse.json(
          { error: "no valid events in body; expected { events: [{ type, payload }] }" },
          { status: 400 },
        ),
        req,
      );
    }
    const results = [];
    for (const env of envelopes) {
      results.push(await handleEvent(admin, env));
    }
    const okCount = results.filter((r) => r.ok).length;
    audit.ok_count = okCount;
    audit.failed_count = envelopes.length - okCount;
    return withCors(
      NextResponse.json({
        accepted: envelopes.length,
        ok: okCount,
        failed: envelopes.length - okCount,
        results,
      }),
      req,
    );
  }

  // Fall through: multipart file upload path.
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    audit.error_summary = `invalid multipart body: ${msg}`.slice(0, 500);
    return withCors(
      NextResponse.json(
        { error: `invalid multipart body: ${msg}` },
        { status: 400 },
      ),
      req,
    );
  }

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  audit.file_count = files.length;
  if (files.length === 0) {
    audit.error_summary = "no files uploaded";
    return withCors(
      NextResponse.json({ error: "no files uploaded" }, { status: 400 }),
      req,
    );
  }

  const results: FileResult[] = [];
  for (const file of files) {
    const kind = classify(file.name, file.type);
    try {
      if (kind === "db") {
        const buf = await file.arrayBuffer();
        const parsed = await parseMorphmarketDb(buf);
        const lUp = await upsertBatched(admin, "market_listings", parsed.listings, "id");
        const sUp = await upsertBatched(admin, "market_sellers", parsed.sellers, "seller_id");
        const failed = lUp.errors.length + sUp.errors.length;
        results.push({
          file: file.name,
          kind,
          ok: failed === 0,
          detail: `listings: ${lUp.sent}/${parsed.listings.length}, sellers: ${sUp.sent}/${parsed.sellers.length}${failed ? ` — ${failed} failed batches` : ""}`,
        });
      } else if (kind === "image") {
        // Caller can override the inferred listing_id with an explicit form
        // field. Cross-platform listings don't match the `mm_\d+` convention,
        // and the extension also uses btoa-derived keys; trusting the
        // filename alone meant those rows were never linked. We accept the
        // first non-empty `listing_id` field across the form as the override.
        const explicitListingId =
          (form.get("listing_id") as string | null)?.trim() || null;
        const explicitImageUrl =
          (form.get("image_url") as string | null)?.trim() || null;
        const fnameMatch = file.name.match(/(mm_\d+|listing_[A-Za-z0-9_-]{3,})/);
        const listingId = explicitListingId ?? (fnameMatch ? fnameMatch[1] : null);

        // Path under {listing_id}/ when known so the bucket layout matches
        // listingImage event-handler uploads. Falls back to a flat
        // timestamped filename for unlinked uploads (still archived, just
        // without a listing FK).
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = listingId
          ? `${listingId}/${Date.now()}-${safeName}`
          : `${Date.now()}-${safeName}`;
        const { error: upErr } = await admin.storage
          .from("listing-images")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const { error: insErr } = await admin.from("listing_images").insert({
          listing_id: listingId,
          image_url: explicitImageUrl,
          storage_bucket: "listing-images",
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: null,
        });
        if (insErr) throw insErr;
        results.push({
          file: file.name,
          kind,
          ok: true,
          detail: `stored at listing-images/${path}${listingId ? `, linked to ${listingId}` : ""}`,
        });
      } else if (kind === "csv") {
        const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await admin.storage
          .from("raw-uploads")
          .upload(path, file, { contentType: file.type || "text/csv" });
        if (upErr) throw upErr;
        results.push({
          file: file.name,
          kind,
          ok: true,
          detail: `archived to raw-uploads/${path}`,
        });
      } else {
        results.push({
          file: file.name,
          kind,
          ok: false,
          detail: `unrecognized file type (${file.type || "no mime"})`,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ file: file.name, kind, ok: false, detail: msg });
    }
  }

  audit.ok_count = results.filter((r) => r.ok).length;
  audit.failed_count = results.filter((r) => !r.ok).length;
  return withCors(NextResponse.json({ results }), req);
}
