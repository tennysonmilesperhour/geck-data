// Fair-price estimator endpoint.
//
//   GET /api/market/fair-price
//     ?combo=lw-axa                 (canonical combo id)
//     &age=adult                    (hatchling | juvenile | subadult | adult | proven_breeder)
//     &sex=female                   (male | female | unknown)
//     &weight=45                    (grams)
//     &proven=true                  (extra signal on top of age=proven_breeder)
//     &recent_sales=5               (include up to N comparable sales)
//
//   POST /api/market/fair-price
//     body: { traits: [...], age?, sex?, weight?, proven?, recent_sales? }
//
// Returns the per-combo p10..p90 distribution from v_combo_price_distribution
// AND the same band scaled by the gecko's individual attributes
// (price_adjustment_factors). Consumers can show either — the morph-classifier
// card in Geck Inspect uses `adjusted`, the /whats-it-worth page shows both.
//
// The `note` field carries the disclaimer text. Front-ends should render
// it verbatim under the price.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HIGH_VALUE_COMBOS, matchCombo } from "@/lib/market/combos";
import {
  applyToBand,
  combinedMultiplier,
  loadMultipliers,
  type AgeClass,
  type Inputs,
  type Sex,
} from "@/lib/market/price-adjust";

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

type RecentSale = {
  listing_id: string;
  sold_usd: number | null;
  sold_at: string;
  days_to_sell: number | null;
  seller_name: string | null;
  source_url: string | null;
};

const DISCLAIMER =
  "Based on current MorphMarket sales trends. Actual value varies with the buyer's perception of pattern quality, parentage, and overall condition.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // Same-combo + same-adjustments queries are highly repeatable; cache for
  // 15 minutes at the edge so the morph-classifier card doesn't hit the DB
  // for every render.
  "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
};

function confidence(n: number): "low" | "medium" | "high" {
  if (n < 10) return "low";
  if (n < 30) return "medium";
  return "high";
}

function parseAge(v: string | null | undefined): AgeClass | null {
  if (!v) return null;
  const norm = v.toLowerCase();
  if (
    norm === "hatchling" ||
    norm === "juvenile" ||
    norm === "subadult" ||
    norm === "adult" ||
    norm === "proven_breeder" ||
    norm === "unknown"
  ) {
    return norm;
  }
  return null;
}

function parseSex(v: string | null | undefined): Sex | null {
  if (!v) return null;
  const norm = v.toLowerCase();
  if (norm === "male" || norm === "female" || norm === "unknown") return norm;
  return null;
}

function parseBool(v: string | null | undefined): boolean | null {
  if (v == null) return null;
  const norm = String(v).toLowerCase();
  if (norm === "true" || norm === "1" || norm === "yes") return true;
  if (norm === "false" || norm === "0" || norm === "no") return false;
  return null;
}

async function lookupDistribution(comboId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("v_combo_price_distribution")
    .select("*")
    .eq("combo_id", comboId)
    .maybeSingle();
  if (error) return { admin, error: error.message, row: null };
  return { admin, error: null, row: data as DistRow | null };
}

/** Free-form trait-set lookup. Uses f_price_band_for_traits (migration 0034)
 *  to support ANY combination of traits, not just the 12 canonical combos.
 *  Returns the same DistRow shape as v_combo_price_distribution. */
async function lookupTraitBand(traits: string[]) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("f_price_band_for_traits", {
    p_traits: traits,
    p_lookback_days: 180,
  });
  if (error) return { admin, error: error.message, row: null };
  const arr = (data ?? []) as Array<{
    n: number;
    p10: number | null;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p90: number | null;
    mean_usd: number | null;
    stddev_usd: number | null;
  }>;
  const first = arr[0];
  const row: DistRow | null =
    first && first.n > 0
      ? {
          combo_id: traits.join(" + "),
          n: first.n,
          p10: first.p10,
          p25: first.p25,
          p50: first.p50,
          p75: first.p75,
          p90: first.p90,
          mean_usd: first.mean_usd,
          stddev_usd: first.stddev_usd,
        }
      : null;
  return { admin, error: null, row };
}

async function buildResponse(opts: {
  comboId: string;
  inputs: Inputs;
  recentSalesN: number;
  matchedFromTraits?: ReturnType<typeof matchCombo>;
}) {
  const { row, admin, error } = await lookupDistribution(opts.comboId);
  if (error) return { error };

  if (!row) {
    return {
      body: {
        combo_id: opts.comboId,
        matched: opts.matchedFromTraits ?? null,
        n: 0,
        base: null,
        adjusted: null,
        applied: null,
        confidence: "low" as const,
        note: DISCLAIMER,
        message: "No sold data in the 180-day window for this combo.",
      },
    };
  }

  const map = await loadMultipliers(admin);
  const { total, applied } = combinedMultiplier(opts.inputs, map);

  const base = {
    p10: row.p10,
    p25: row.p25,
    p50: row.p50,
    p75: row.p75,
    p90: row.p90,
    mean: row.mean_usd,
  };
  const adjusted = applyToBand(base, total);

  let recentSales: RecentSale[] = [];
  if (opts.recentSalesN > 0) {
    const { data } = await admin
      .from("v_recent_combo_sales")
      .select("listing_id, sold_usd, sold_at, days_to_sell, seller_name, source_url")
      .eq("combo_id", opts.comboId)
      .order("sold_at", { ascending: false })
      .limit(opts.recentSalesN);
    recentSales = (data ?? []) as RecentSale[];
  }

  return {
    body: {
      combo_id: opts.comboId,
      matched: opts.matchedFromTraits ?? null,
      n: row.n,
      base,
      adjusted,
      applied,
      multiplier_total: total,
      confidence: confidence(row.n),
      note: DISCLAIMER,
      recent_sales: opts.recentSalesN > 0 ? recentSales : undefined,
    },
  };
}

/** Trait-set response builder. Uses lookupTraitBand + f_recent_sales_for_traits
 *  so the caller can pass any traits, not just the curated 12 combos. */
async function buildTraitResponse(opts: {
  traits: string[];
  inputs: Inputs;
  recentSalesN: number;
}) {
  const { row, admin, error } = await lookupTraitBand(opts.traits);
  if (error) return { error };

  if (!row || row.n === 0) {
    return {
      body: {
        traits: opts.traits,
        n: 0,
        base: null,
        adjusted: null,
        applied: null,
        confidence: "low" as const,
        note: DISCLAIMER,
        message:
          opts.traits.length === 0
            ? "Pick at least one trait."
            : `No sold listings in the last 180 days contain all of: ${opts.traits.join(", ")}. Try fewer traits or broader synonyms.`,
      },
    };
  }

  const map = await loadMultipliers(admin);
  const { total, applied } = combinedMultiplier(opts.inputs, map);
  const base = {
    p10: row.p10,
    p25: row.p25,
    p50: row.p50,
    p75: row.p75,
    p90: row.p90,
    mean: row.mean_usd,
  };
  const adjusted = applyToBand(base, total);

  let recentSales: RecentSale[] = [];
  if (opts.recentSalesN > 0) {
    const { data } = await admin.rpc("f_recent_sales_for_traits", {
      p_traits: opts.traits,
      p_limit: opts.recentSalesN,
      p_lookback_days: 180,
    });
    recentSales = ((data ?? []) as RecentSale[]).slice(0, opts.recentSalesN);
  }

  return {
    body: {
      traits: opts.traits,
      n: row.n,
      base,
      adjusted,
      applied,
      multiplier_total: total,
      confidence: confidence(row.n),
      note: DISCLAIMER,
      recent_sales: opts.recentSalesN > 0 ? recentSales : undefined,
    },
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const comboId = url.searchParams.get("combo")?.trim();
  const traitsParam = url.searchParams.get("traits")?.trim();

  const inputs: Inputs = {
    age: parseAge(url.searchParams.get("age")),
    sex: parseSex(url.searchParams.get("sex")),
    weight_grams: numOrNull(url.searchParams.get("weight")),
    proven: parseBool(url.searchParams.get("proven")),
  };
  const recentSalesN = Math.min(
    Math.max(0, Number(url.searchParams.get("recent_sales") ?? "0") || 0),
    10,
  );

  // Free-form trait mode — preferred. Any number of traits, no whitelist.
  if (traitsParam) {
    const traits = traitsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (traits.length === 0) {
      return NextResponse.json(
        { error: "traits param empty" },
        { status: 400, headers: corsHeaders },
      );
    }
    const out = await buildTraitResponse({ traits, inputs, recentSalesN });
    if ("error" in out) {
      return NextResponse.json({ error: out.error }, { status: 500, headers: corsHeaders });
    }
    return NextResponse.json(out.body, { headers: corsHeaders });
  }

  // Legacy combo-id mode — kept for the Geck Inspect classifier card
  // which still passes canonical combo ids derived from the morph model.
  if (!comboId) {
    return NextResponse.json(
      {
        error: "?traits=trait1,trait2 (preferred) or ?combo=<id>",
        supported_combos: HIGH_VALUE_COMBOS.map((c) => c.id),
      },
      { status: 400, headers: corsHeaders },
    );
  }
  if (!HIGH_VALUE_COMBOS.find((c) => c.id === comboId)) {
    return NextResponse.json(
      {
        error: `unknown combo id ${comboId}`,
        supported_combos: HIGH_VALUE_COMBOS.map((c) => c.id),
      },
      { status: 404, headers: corsHeaders },
    );
  }
  const out = await buildResponse({ comboId, inputs, recentSalesN });
  if ("error" in out) {
    return NextResponse.json({ error: out.error }, { status: 500, headers: corsHeaders });
  }
  return NextResponse.json(out.body, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers: corsHeaders });
  }
  const b = body as {
    traits?: unknown;
    age?: unknown;
    sex?: unknown;
    weight?: unknown;
    proven?: unknown;
    recent_sales?: unknown;
  };
  if (!Array.isArray(b.traits) || b.traits.length === 0) {
    return NextResponse.json(
      { error: "traits[] required" },
      { status: 400, headers: corsHeaders },
    );
  }
  const traits = b.traits
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim());
  const inputs: Inputs = {
    age: parseAge(typeof b.age === "string" ? b.age : null),
    sex: parseSex(typeof b.sex === "string" ? b.sex : null),
    weight_grams: typeof b.weight === "number" ? b.weight : numOrNull(b.weight as string),
    proven: typeof b.proven === "boolean" ? b.proven : parseBool(b.proven as string),
  };
  const recentSalesN = Math.min(
    Math.max(0, Number(b.recent_sales ?? 0) || 0),
    10,
  );

  // Trait-set mode (default) — always answers, not limited to 12 combos.
  // Also report whether the traits happened to match one of the canonical
  // combos so the Geck Inspect card can show "Lilly White × Axanthic" as
  // a name when applicable.
  const matched = matchCombo(traits);
  const out = await buildTraitResponse({ traits, inputs, recentSalesN });
  if ("error" in out) {
    return NextResponse.json({ error: out.error }, { status: 500, headers: corsHeaders });
  }
  return NextResponse.json(
    { ...out.body, matched: matched ?? null },
    { headers: corsHeaders },
  );
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
