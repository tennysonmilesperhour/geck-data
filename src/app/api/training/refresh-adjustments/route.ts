// Refresh price_adjustment_factors from observed sold-listing data.
//
//   POST /api/training/refresh-adjustments
//     (bearer-gated, same convention as /api/training/queue)
//     ?window_days=180   (defaults to 180; capped at 730)
//     ?dry_run=1         (don't write, just return what we'd write)
//
// For each factor category we compute:
//
//   multiplier(bucket) = median(price_within_bucket) / median(price_overall)
//
// then clamp to [0.4, 1.8] to bound outliers and write to
// price_adjustment_factors with source='empirical_<iso>'.
//
// Why median, not mean: the sold-price distribution has long right tails
// (one $4000 outlier blows up the mean) and we want the multiplier to be
// representative of the typical listing in each bucket. Why clamp: an
// underpopulated bucket can show extreme ratios; clamping bounds the
// blast radius if the bucket has 3 samples and one happens to be a
// proven breeder going for $50.
//
// Sample-size gate: any bucket with n < 20 keeps its seed value.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { weightBucket, type AgeClass } from "@/lib/market/price-adjust";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_SAMPLES_PER_BUCKET = 20;
const CLAMP_MIN = 0.4;
const CLAMP_MAX = 1.8;

type SoldRow = {
  id: string;
  price_usd_equivalent: number | null;
  price: number | null;
  maturity: string | null;
  sex: string | null;
  weight: number | string | null;
  parentage: string | null;
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function classifyAgeLocal(maturity: string | null): AgeClass {
  if (!maturity) return "unknown";
  const m = maturity.toLowerCase();
  if (/proven\s*breed/.test(m)) return "proven_breeder";
  if (/adult/.test(m)) return "adult";
  if (/sub[\s-]?adult/.test(m)) return "subadult";
  if (/juven|yearling/.test(m)) return "juvenile";
  if (/hatch|baby|neonate/.test(m)) return "hatchling";
  return "unknown";
}

function parseGrams(v: number | string | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const match = String(v).match(/([\d.]+)/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return Number.isFinite(n) ? n : null;
}

function inferProven(row: SoldRow): boolean {
  // No dedicated boolean on market_listings — proven status leaks through the
  // free-text columns. parentage carries breeder notes; maturity carries the
  // string "Proven Breeder" for confirmed adults.
  if (row.parentage && /proven/i.test(row.parentage)) return true;
  if (row.maturity && /proven/i.test(row.maturity)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const expected = process.env.INGEST_API_KEY;
  const presented =
    req.headers.get("authorization")?.replace(/^Bearer /, "") ??
    req.headers.get("x-api-key") ??
    "";
  if (!expected || presented !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const windowDays = Math.min(
    Math.max(30, Number(url.searchParams.get("window_days") ?? "180") || 180),
    730,
  );
  const dryRun = url.searchParams.get("dry_run") === "1";

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "admin" }, { status: 500 });
  }

  // Pull every sold listing in the window. The join fetches each market_listing
  // and its sold event; we limit to crested-or-unknown species per the
  // product scope.
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const { data: sales, error } = await admin
    .from("listing_status_events")
    .select(
      "listing_id, observed_at, market_listings(id, price_usd_equivalent, price, maturity, sex, weight, parentage, species)",
    )
    .eq("status", "sold")
    .gte("observed_at", since)
    .limit(20000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows: Array<{ price: number; row: SoldRow }> = [];
  for (const r of ((sales ?? []) as unknown) as Array<{
    listing_id: string;
    market_listings:
      | (SoldRow & { species: string | null })
      | Array<SoldRow & { species: string | null }>
      | null;
  }>) {
    const mlRaw = r.market_listings;
    const ml = Array.isArray(mlRaw) ? mlRaw[0] ?? null : mlRaw;
    if (!ml) continue;
    if (ml.species && ml.species !== "crested" && ml.species !== "unknown") continue;
    const price = ml.price_usd_equivalent ?? ml.price;
    if (!price || price <= 0 || price >= 10_000) continue;
    rows.push({ price, row: ml });
  }

  if (rows.length === 0) {
    return NextResponse.json({
      window_days: windowDays,
      sample_size: 0,
      message: "no sold rows in window",
    });
  }

  const overallMedian = median(rows.map((r) => r.price));

  // Bucket samples by category.
  const ageBuckets = new Map<AgeClass, number[]>();
  const sexBuckets = new Map<string, number[]>();
  const provenBuckets = new Map<string, number[]>();
  const weightBuckets = new Map<string, number[]>();

  function push<K>(map: Map<K, number[]>, key: K, price: number) {
    const arr = map.get(key) ?? [];
    arr.push(price);
    map.set(key, arr);
  }

  for (const { price, row } of rows) {
    const age = classifyAgeLocal(row.maturity);
    push(ageBuckets, age, price);

    const sex = (row.sex ?? "").toLowerCase();
    const sexKey = sex === "male" || sex === "female" ? sex : "unknown";
    push(sexBuckets, sexKey, price);

    const proven = inferProven(row);
    push(provenBuckets, proven ? "true" : "false", price);

    const grams = parseGrams(row.weight);
    if (grams != null) {
      push(weightBuckets, weightBucket(grams, age), price);
    }
  }

  // Compute clamped multipliers per bucket; gate by MIN_SAMPLES_PER_BUCKET.
  type Update = {
    category: "age" | "sex" | "proven" | "weight_bucket";
    bucket: string;
    multiplier: number;
    n: number;
    raw_ratio: number;
  };
  const updates: Update[] = [];

  function emit(category: Update["category"], map: Map<string, number[]>) {
    for (const [bucket, prices] of map.entries()) {
      if (prices.length < MIN_SAMPLES_PER_BUCKET) continue;
      const ratio = median(prices) / overallMedian;
      updates.push({
        category,
        bucket,
        multiplier: Number(clamp(ratio, CLAMP_MIN, CLAMP_MAX).toFixed(4)),
        n: prices.length,
        raw_ratio: Number(ratio.toFixed(4)),
      });
    }
  }
  emit("age", ageBuckets as Map<string, number[]>);
  emit("sex", sexBuckets);
  emit("proven", provenBuckets);
  emit("weight_bucket", weightBuckets);

  if (dryRun) {
    return NextResponse.json({
      window_days: windowDays,
      sample_size: rows.length,
      overall_median_usd: overallMedian,
      would_write: updates,
      dry_run: true,
    });
  }

  // Upsert. We tag the source with an ISO timestamp so the operator can
  // see when the multiplier was last refreshed by looking at the row.
  const stamp = new Date().toISOString();
  const writeRows = updates.map((u) => ({
    category: u.category,
    bucket: u.bucket,
    multiplier: u.multiplier,
    source: `empirical_${stamp}`,
    n_samples: u.n,
    updated_at: stamp,
  }));

  if (writeRows.length === 0) {
    return NextResponse.json({
      window_days: windowDays,
      sample_size: rows.length,
      message: "no buckets met the minimum sample threshold; nothing written",
    });
  }

  const { error: writeErr } = await admin
    .from("price_adjustment_factors")
    .upsert(writeRows, { onConflict: "category,bucket" });
  if (writeErr) {
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  return NextResponse.json({
    window_days: windowDays,
    sample_size: rows.length,
    overall_median_usd: overallMedian,
    written: writeRows.length,
    updates,
  });
}
