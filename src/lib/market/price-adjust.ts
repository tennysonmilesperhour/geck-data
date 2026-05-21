// Multiplier-based price adjustment for the fair-price endpoint.
//
// The base distribution per canonical combo comes from
// v_combo_price_distribution. This module applies bucket multipliers
// (loaded from public.price_adjustment_factors) to that base for the
// gecko's individual attributes:
//
//   - age class       (hatchling | juvenile | subadult | adult | proven_breeder)
//   - sex             (male | female | unknown)
//   - proven flag     (true | false)
//   - weight bucket   (underweight | normal | heavy) — computed here
//
// The weight bucket is derived from raw grams relative to the age class so
// "20g hatchling" is heavy and "20g adult" is underweight without needing
// to store every weight × age combination separately.
//
// All four multipliers compound multiplicatively. The endpoint applies
// them to every percentile in the distribution and returns both the base
// and adjusted bands so the front-end can show "without adjustment" if it
// wants to.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AgeClass =
  | "hatchling"
  | "juvenile"
  | "subadult"
  | "adult"
  | "proven_breeder"
  | "unknown";

export type Sex = "male" | "female" | "unknown";
export type WeightBucket = "underweight" | "normal" | "heavy";

export type Inputs = {
  age?: AgeClass | null;
  sex?: Sex | null;
  weight_grams?: number | null;
  proven?: boolean | null;
};

export type MultiplierMap = {
  age: Record<string, number>;
  sex: Record<string, number>;
  proven: Record<string, number>;
  weight_bucket: Record<string, number>;
};

const FALLBACK_MULTIPLIERS: MultiplierMap = {
  age: {
    hatchling: 0.55,
    juvenile: 0.75,
    subadult: 1.0,
    adult: 1.2,
    proven_breeder: 1.4,
    unknown: 1.0,
  },
  sex: { female: 1.15, male: 1.0, unknown: 1.0 },
  proven: { true: 1.1, false: 1.0 },
  weight_bucket: { underweight: 0.85, normal: 1.0, heavy: 1.05 },
};

let cache: { map: MultiplierMap; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

/** Load multipliers from price_adjustment_factors with a 5-minute cache.
 *  Falls back to the in-process FALLBACK_MULTIPLIERS if the table isn't
 *  reachable (preview branches without the migration applied, transient
 *  DB error) so the endpoint never 500s on a price lookup. */
export async function loadMultipliers(admin: SupabaseClient): Promise<MultiplierMap> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.map;
  const { data, error } = await admin
    .from("price_adjustment_factors")
    .select("category, bucket, multiplier");
  if (error || !data) {
    cache = { map: FALLBACK_MULTIPLIERS, at: now };
    return FALLBACK_MULTIPLIERS;
  }
  const out: MultiplierMap = {
    age: {},
    sex: {},
    proven: {},
    weight_bucket: {},
  };
  for (const row of data as Array<{ category: keyof MultiplierMap; bucket: string; multiplier: number }>) {
    if (out[row.category]) out[row.category][row.bucket] = Number(row.multiplier);
  }
  // Fill any missing buckets with the fallback so a half-populated table
  // doesn't produce NaN.
  for (const cat of Object.keys(FALLBACK_MULTIPLIERS) as Array<keyof MultiplierMap>) {
    for (const bucket of Object.keys(FALLBACK_MULTIPLIERS[cat])) {
      if (out[cat][bucket] == null) out[cat][bucket] = FALLBACK_MULTIPLIERS[cat][bucket];
    }
  }
  cache = { map: out, at: now };
  return out;
}

/** Test hook. */
export function _resetMultiplierCache(): void {
  cache = null;
}

/** Compute a weight bucket given grams + age class. The thresholds are
 *  crested-gecko-specific and match the bands used by classifyAge() in
 *  lib/market/age.ts. */
export function weightBucket(grams: number, age: AgeClass): WeightBucket {
  // Adult / proven breeder norms.
  if (age === "adult" || age === "proven_breeder") {
    if (grams < 35) return "underweight";
    if (grams >= 60) return "heavy";
    return "normal";
  }
  if (age === "subadult") {
    if (grams < 18) return "underweight";
    if (grams >= 40) return "heavy";
    return "normal";
  }
  if (age === "juvenile") {
    if (grams < 5) return "underweight";
    if (grams >= 20) return "heavy";
    return "normal";
  }
  if (age === "hatchling") {
    if (grams < 1.5) return "underweight";
    if (grams >= 6) return "heavy";
    return "normal";
  }
  // Unknown age: don't penalise on weight, treat as normal.
  return "normal";
}

/** Resolve the combined multiplier for an individual gecko. Caller passes
 *  in the loaded MultiplierMap; this is pure so it's trivially testable. */
export function combinedMultiplier(
  inputs: Inputs,
  map: MultiplierMap,
): { total: number; applied: Record<string, number> } {
  const applied: Record<string, number> = {};

  const age = inputs.age ?? "unknown";
  applied.age = map.age[age] ?? 1.0;

  const sex = inputs.sex ?? "unknown";
  applied.sex = map.sex[sex] ?? 1.0;

  // Proven flag is independent of age=proven_breeder so a young confirmed
  // breeder still gets the bonus. Default false when unset.
  applied.proven = map.proven[String(inputs.proven === true)] ?? 1.0;

  if (typeof inputs.weight_grams === "number" && inputs.weight_grams > 0) {
    const bucket = weightBucket(inputs.weight_grams, age);
    applied.weight_bucket = map.weight_bucket[bucket] ?? 1.0;
  } else {
    applied.weight_bucket = 1.0;
  }

  // Compound multiplicatively. Round to 4 dp so the response JSON doesn't
  // ship floating-point noise like 1.0000000000000002.
  const total = Number(
    (applied.age * applied.sex * applied.proven * applied.weight_bucket).toFixed(4),
  );
  return { total, applied };
}

/** Apply a multiplier to a percentile band. Each percentile is rounded
 *  to the nearest dollar so the response doesn't ship $432.96 — at the
 *  precision of MorphMarket prices, cents are noise. */
export function applyToBand<T extends Record<string, number | null>>(
  band: T,
  multiplier: number,
): T {
  const out = { ...band };
  for (const k of Object.keys(out)) {
    const v = out[k as keyof T];
    if (typeof v === "number" && Number.isFinite(v)) {
      (out as Record<string, number | null>)[k] = Math.round(v * multiplier);
    }
  }
  return out;
}
