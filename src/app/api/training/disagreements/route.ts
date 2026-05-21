// Model-vs-human disagreement queue (#12).
//
//   GET /api/training/disagreements?limit=50
//
// Joins model_invocations.predicted_combo_id against morph_human_labels.combo_id
// and surfaces rows where they differ. These are the highest-value examples
// for the next training batch: the model was wrong and we know what right is.
//
// Bearer-gated with INGEST_API_KEY (same convention as /api/training/queue).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  invocation_id: number;
  listing_id: string | null;
  predicted_combo_id: string | null;
  actual_combo_id: string | null;
  confidence: number | null;
  called_at: string;
  labeled_at: string;
  labeler: string;
};

export async function GET(req: NextRequest) {
  const expected = process.env.INGEST_API_KEY;
  const presented =
    req.headers.get("authorization")?.replace(/^Bearer /, "") ??
    req.headers.get("x-api-key") ??
    "";
  if (!expected || presented !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "admin" }, { status: 500 });
  }

  // Pull recent human-labeled invocations and filter mismatches in-process.
  // The cardinality is small (human labels arrive in dozens/day) so this
  // doesn't merit a dedicated view yet — promote when needed.
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data, error } = await admin
    .from("morph_human_labels")
    .select(
      "invocation_id, listing_id, combo_id, labeled_at, labeler, model_invocations(id, predicted_combo_id, confidence, called_at)",
    )
    .gte("labeled_at", since)
    .order("labeled_at", { ascending: false })
    .limit(limit * 4);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Supabase returns FK-joined data as an array even for single-row joins.
  // Normalise to the first element here.
  const rows: Row[] = [];
  for (const r of ((data ?? []) as unknown) as Array<{
    invocation_id: number;
    listing_id: string | null;
    combo_id: string | null;
    labeled_at: string;
    labeler: string;
    model_invocations:
      | {
          id: number;
          predicted_combo_id: string | null;
          confidence: number | null;
          called_at: string;
        }
      | Array<{
          id: number;
          predicted_combo_id: string | null;
          confidence: number | null;
          called_at: string;
        }>
      | null;
  }>) {
    const invRaw = r.model_invocations;
    const inv = Array.isArray(invRaw) ? invRaw[0] ?? null : invRaw;
    if (!inv) continue;
    if ((inv.predicted_combo_id ?? null) === (r.combo_id ?? null)) continue;
    rows.push({
      invocation_id: inv.id,
      listing_id: r.listing_id,
      predicted_combo_id: inv.predicted_combo_id,
      actual_combo_id: r.combo_id,
      confidence: inv.confidence,
      called_at: inv.called_at,
      labeled_at: r.labeled_at,
      labeler: r.labeler,
    });
    if (rows.length >= limit) break;
  }

  return NextResponse.json({
    count: rows.length,
    disagreements: rows,
    generated_at: new Date().toISOString(),
  });
}
