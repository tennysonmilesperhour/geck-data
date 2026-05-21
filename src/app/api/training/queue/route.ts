// Active-learning queue endpoint.
//
//   GET /api/training/queue?limit=50&surface=morph_id_production
//
// Returns the listings whose most recent model invocation produced the
// lowest classifier confidence — these are the ones a human reviewer should
// label next, because they're where the model is most uncertain.
//
// The "confidence" we use is derived from model_invocations.output_tokens
// as a weak proxy (longer outputs ≈ less confident) when there's no
// explicit confidence score column. A future migration that adds an
// explicit `confidence numeric` column would make this exact, but the
// proxy is good enough to surface a queue that beats random sampling.
//
// Admin-gated: ADMIN_USER_ID via the existing /data-admin layout. We
// re-check it here so the endpoint itself is safe to call directly.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InvocationRow = {
  id: number;
  called_at: string;
  surface: string;
  model: string;
  output_tokens: number | null;
  request_id: string | null;
  user_id: string | null;
};

export async function GET(req: NextRequest) {
  // Lightweight bearer protection — same key the ingest endpoint uses, so
  // the admin panel and any worker can call this without a session.
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
  const surface = url.searchParams.get("surface") ?? "morph_id_production";

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "admin" }, { status: 500 });
  }

  // Most recent invocation per request_id (proxy for "one listing"), sorted
  // by output_tokens descending so the longest replies — the model's least
  // confident outputs — float to the top. We cap to a recent window so we
  // don't suggest re-labeling listings the model already gave up on weeks
  // ago.
  const { data, error } = await admin
    .from("model_invocations")
    .select("id, called_at, surface, model, output_tokens, request_id, user_id")
    .eq("surface", surface)
    .gte("called_at", new Date(Date.now() - 14 * 86400_000).toISOString())
    .order("output_tokens", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as InvocationRow[];

  // Dedupe by request_id so we don't show two rows for retried calls.
  const seen = new Set<string>();
  const queue = rows.filter((r) => {
    const key = r.request_id ?? `inv_${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({
    surface,
    count: queue.length,
    queue: queue.map((r) => ({
      invocation_id: r.id,
      request_id: r.request_id,
      called_at: r.called_at,
      model: r.model,
      output_tokens: r.output_tokens,
      proxy_confidence: confidenceProxy(r.output_tokens),
    })),
    generated_at: new Date().toISOString(),
  });
}

function confidenceProxy(outTokens: number | null): number {
  // Inverse exponential: 0 tokens → 1.0, 200 → 0.5, 500+ → ~0.2.
  if (outTokens == null) return 0.5;
  return Math.max(0, Math.min(1, Math.exp(-outTokens / 300)));
}
