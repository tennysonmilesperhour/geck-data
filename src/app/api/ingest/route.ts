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

// GET — Bearer-gated diagnostic. Returns per-table row counts plus a check
// that the touch_listing_seen RPC from migration 0002 registered, so we can
// tell end-to-end whether the extension's events are landing in Supabase
// (and, if they are not, which specific piece is broken).
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `admin client: ${msg}` }, { status: 500 });
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

  return NextResponse.json({ counts, touchRpc, mostRecent: recency });
}

export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/ingest] fatal:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const admin = createAdminClient();

  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const envelopes = parseEnvelopes(body);
    if (envelopes.length === 0) {
      return NextResponse.json(
        { error: "no valid events in body; expected { events: [{ type, payload }] }" },
        { status: 400 },
      );
    }
    const results = [];
    for (const env of envelopes) {
      results.push(await handleEvent(admin, env));
    }
    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({
      accepted: envelopes.length,
      ok: okCount,
      failed: envelopes.length - okCount,
      results,
    });
  }

  // Fall through: multipart file upload path.
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `invalid multipart body: ${msg}` },
      { status: 400 },
    );
  }

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no files uploaded" }, { status: 400 });
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
        const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await admin.storage
          .from("listing-images")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const m = file.name.match(/(mm_\d+)/);
        const listingId = m ? m[1] : null;
        const { error: insErr } = await admin.from("listing_images").insert({
          listing_id: listingId,
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

  return NextResponse.json({ results });
}
