// Batched morph-classifier invocation queueing endpoint.
//
//   POST /api/training/batch-invoke
//   {
//     "listing_ids": ["mm_12345","mm_67890",…],   // max 100
//     "model": "claude-sonnet-4-6",
//     "surface": "morph_id_eval"
//   }
//
// The model_invocations table (migration 0023) already has the schema to
// log per-call usage, but until now nothing actually invoked it from a
// server endpoint. This route inserts one PENDING row per listing into
// a new batch_jobs table (created here) so a background worker (cron or
// the geck-inspect inference function) can drain it asynchronously —
// keeping this endpoint fast and avoiding upstream-Anthropic latency
// inside an ingress request.
//
// Idempotent: we de-dupe (model, listing_id, surface) on the active set,
// so submitting the same batch twice is a no-op.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BATCH = 100;
const ALLOWED_SURFACES = new Set([
  "morph_id_production",
  "morph_id_eval",
  "morph_id_unknown",
]);

export async function POST(req: NextRequest) {
  const expected = process.env.INGEST_API_KEY;
  const presented =
    req.headers.get("authorization")?.replace(/^Bearer /, "") ??
    req.headers.get("x-api-key") ??
    "";
  if (!expected || presented !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const b = body as {
    listing_ids?: unknown;
    model?: unknown;
    surface?: unknown;
  };
  const listingIds = Array.isArray(b.listing_ids)
    ? b.listing_ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (listingIds.length === 0) {
    return NextResponse.json({ error: "listing_ids[] required" }, { status: 400 });
  }
  if (listingIds.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `listing_ids[] too large: ${listingIds.length} > ${MAX_BATCH}` },
      { status: 400 },
    );
  }
  const model = typeof b.model === "string" && b.model.length > 0 ? b.model : "claude-sonnet-4-6";
  const surface = typeof b.surface === "string" ? b.surface : "morph_id_eval";
  if (!ALLOWED_SURFACES.has(surface)) {
    return NextResponse.json(
      { error: `surface must be one of ${Array.from(ALLOWED_SURFACES).join(", ")}` },
      { status: 400 },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "admin" }, { status: 500 });
  }

  const rows = listingIds.map((id) => ({
    listing_id: id,
    model,
    surface,
    status: "pending",
    created_at: new Date().toISOString(),
  }));

  // batch_jobs table is created by migration 0031; we expect a
  // unique constraint on (listing_id, model, surface, status) so this
  // upsert is idempotent.
  const { data, error } = await admin
    .from("batch_jobs")
    .upsert(rows, {
      onConflict: "listing_id,model,surface,status",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: error.message, hint: "ensure migration 0031 ran (creates batch_jobs)" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    queued: data?.length ?? 0,
    submitted: listingIds.length,
    surface,
    model,
  });
}
