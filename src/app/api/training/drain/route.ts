// Cron-driven worker that drains batch_jobs (migration 0031) by claiming
// pending rows, calling Anthropic, writing back to model_invocations, and
// flipping job status.
//
//   GET /api/training/drain?limit=10
//
// This deliberately does NOT call Anthropic inline when ANTHROPIC_API_KEY
// is missing — it logs a stub model_invocations row so /data-admin can show
// the loop is alive in environments (preview branches, CI) that don't carry
// the production key. Set ANTHROPIC_API_KEY in env to enable real calls.
//
// Bearer-gated with INGEST_API_KEY so a Vercel Cron or external scheduler
// can call without a user session.
//
// Idempotency: claim_batch_jobs uses SELECT … FOR UPDATE SKIP LOCKED so
// parallel invocations don't double-process the same row.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type BatchJob = {
  id: number;
  listing_id: string;
  model: string;
  surface: string;
  status: string;
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
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "10"), 50);

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "admin" }, { status: 500 });
  }

  // Claim a batch atomically.
  const { data: claimed, error: claimErr } = await admin.rpc("claim_batch_jobs", {
    p_limit: limit,
    p_worker: `vercel-cron-${Date.now()}`,
  });
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  const jobs = (claimed ?? []) as BatchJob[];
  if (jobs.length === 0) {
    return NextResponse.json({ claimed: 0, processed: 0 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  let done = 0;
  let failed = 0;

  await Promise.all(
    jobs.map(async (job) => {
      try {
        const start = Date.now();
        let invocationRow: Record<string, unknown> = {
          surface: job.surface,
          model: job.model,
          called_at: new Date().toISOString(),
        };
        let predicted: string | null = null;
        let confidence: number | null = null;

        if (anthropicKey) {
          const result = await callAnthropic(anthropicKey, job);
          invocationRow = { ...invocationRow, ...result.invocation };
          predicted = result.predicted_combo_id;
          confidence = result.confidence;
        } else {
          // Stub path so preview environments can exercise the loop without
          // burning Anthropic credit. Tag the row clearly.
          invocationRow.error_code = "stub_no_api_key";
          invocationRow.duration_ms = Date.now() - start;
        }
        invocationRow.predicted_combo_id = predicted;
        invocationRow.confidence = confidence;

        const { data: inv } = await admin
          .from("model_invocations")
          .insert(invocationRow)
          .select("id")
          .maybeSingle();

        await admin
          .from("batch_jobs")
          .update({
            status: "done",
            finished_at: new Date().toISOString(),
            invocation_id: inv?.id ?? null,
            result: { predicted_combo_id: predicted, confidence },
          })
          .eq("id", job.id);
        done++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin
          .from("batch_jobs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            error_summary: msg.slice(0, 500),
          })
          .eq("id", job.id);
        failed++;
      }
    }),
  );

  return NextResponse.json({
    claimed: jobs.length,
    processed: done,
    failed,
  });
}

type AnthropicResult = {
  invocation: Record<string, unknown>;
  predicted_combo_id: string | null;
  confidence: number | null;
};

/**
 * Minimal Anthropic call. Production morph-id flows use the prompts in
 * the Eye in the Sky / Geck Inspect repos; here we just want to exercise
 * the loop with a tiny synthetic classification so the drain worker is
 * useful for evaluation runs.
 *
 * Real implementations should pass listing images via the image content
 * block; this stub posts only the listing_id text which trains the round
 * trip without consuming much cost.
 */
async function callAnthropic(key: string, job: BatchJob): Promise<AnthropicResult> {
  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: job.model,
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: `Listing id: ${job.listing_id}. Reply with the most likely canonical combo id from this set: lw-axa, lw-cap, cap-pin, axa-pin, sable-harl, frap-pin, moonglow-dal, lw-soft, axa-harl, cap-dal, red-harl, tiger-pin. Reply with the id only, or "none".`,
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const duration = Date.now() - start;
  if (!res.ok) {
    return {
      invocation: {
        http_status: res.status,
        duration_ms: duration,
        error_code: `http_${res.status}`,
      },
      predicted_combo_id: null,
      confidence: null,
    };
  }
  const body = (await res.json()) as {
    content?: Array<{ text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    id?: string;
  };
  const raw = body.content?.[0]?.text?.trim().toLowerCase() ?? "";
  const predicted = /^[a-z]+(?:-[a-z]+)+$/.test(raw) ? raw : raw === "none" ? null : null;
  return {
    invocation: {
      http_status: 200,
      duration_ms: duration,
      input_tokens: body.usage?.input_tokens,
      output_tokens: body.usage?.output_tokens,
      cache_read_tokens: body.usage?.cache_read_input_tokens,
      cache_creation_tokens: body.usage?.cache_creation_input_tokens,
      request_id: body.id,
    },
    predicted_combo_id: predicted,
    // Without a structured confidence from the model, fall back to a
    // simple proxy: shorter "id only" replies are higher confidence.
    confidence: predicted ? Math.max(0.3, 1 - (body.usage?.output_tokens ?? 0) / 64) : 0.1,
  };
}
