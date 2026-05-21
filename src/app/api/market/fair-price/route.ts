// Fair-price estimator endpoint.
//
//   GET  /api/market/fair-price?combo=lw-axa
//   POST /api/market/fair-price  { traits: ["Lilly White","Axanthic"] }
//
// Returns the p10..p90 sold-price distribution for the combo over the last
// 180 days, sourced from v_combo_price_distribution. Output:
//
//   {
//     combo_id, n, p10, p25, p50, p75, p90,
//     mean_usd, stddev_usd, confidence: "low"|"medium"|"high"
//   }
//
// Confidence is a function of sample size: <10 = low, <30 = medium, else high.
// Callers should respect "low" and not surface a price band to end users.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HIGH_VALUE_COMBOS, matchCombo } from "@/lib/market/combos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DistRow = {
  combo_id: string;
  n: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  mean_usd: number | null;
  stddev_usd: number | null;
};

function confidence(n: number): "low" | "medium" | "high" {
  if (n < 10) return "low";
  if (n < 30) return "medium";
  return "high";
}

async function lookupCombo(comboId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("v_combo_price_distribution")
    .select("*")
    .eq("combo_id", comboId)
    .maybeSingle();
  if (error) return { error: error.message, row: null };
  return { error: null, row: data as DistRow | null };
}

function envelope(row: DistRow | null, comboId: string) {
  if (!row) {
    return {
      combo_id: comboId,
      n: 0,
      p10: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
      mean_usd: null,
      stddev_usd: null,
      confidence: "low" as const,
      message: "no sold data in window",
    };
  }
  return {
    ...row,
    confidence: confidence(row.n),
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const comboId = url.searchParams.get("combo")?.trim();
  if (!comboId) {
    return NextResponse.json(
      { error: "?combo=<id> required (or POST {traits})", supported: HIGH_VALUE_COMBOS.map((c) => c.id) },
      { status: 400, headers: corsHeaders },
    );
  }
  if (!HIGH_VALUE_COMBOS.find((c) => c.id === comboId)) {
    return NextResponse.json(
      { error: `unknown combo id ${comboId}`, supported: HIGH_VALUE_COMBOS.map((c) => c.id) },
      { status: 404, headers: corsHeaders },
    );
  }
  const { error, row } = await lookupCombo(comboId);
  if (error) {
    return NextResponse.json({ error }, { status: 500, headers: corsHeaders });
  }
  return NextResponse.json(envelope(row, comboId), { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers: corsHeaders });
  }
  const traits = (body as { traits?: unknown }).traits;
  if (!Array.isArray(traits) || traits.length === 0) {
    return NextResponse.json({ error: "traits[] required" }, { status: 400, headers: corsHeaders });
  }
  const combo = matchCombo(traits);
  if (!combo) {
    return NextResponse.json(
      {
        combo_id: null,
        message: "traits do not match any canonical combo",
        supported: HIGH_VALUE_COMBOS.map((c) => ({ id: c.id, name: c.name })),
      },
      { headers: corsHeaders },
    );
  }
  const { error, row } = await lookupCombo(combo.id);
  if (error) {
    return NextResponse.json({ error }, { status: 500, headers: corsHeaders });
  }
  return NextResponse.json({ matched: combo, ...envelope(row, combo.id) }, { headers: corsHeaders });
}
