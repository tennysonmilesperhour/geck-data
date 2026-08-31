// Combo-level KR vs US ask comparison used by the Arbitrage source axis.
//
// Reads:
//   - cross_platform_listings platform=feedle_air, USD, crested, priced
//   - market_listings current_status=live, not is_group_lot
// Matching is HIGH_VALUE_COMBOS on traits/title, not pHash.
// Does not write, and does not read MorphMarket median views.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sampleConfidence } from "@/lib/market/sample-confidence";
import {
  KR_LABEL,
  SOURCE_ARB_MIN_N,
  US_LABEL,
  buildSourceArbRows,
  combosFromListing,
  looksLikeNonCrested,
  payloadFlaggedGroupLot,
  payloadIsSold,
  type SourceAsk,
} from "@/lib/market/source-arbitrage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 1000;

const headers = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
  "Access-Control-Allow-Origin": "*",
};

type MmRow = {
  title: string | null;
  cached_traits: string | null;
  norm_traits: string | null;
  price: number | string | null;
  price_usd_equivalent: number | string | null;
  species: string | null;
};

type FeedleRow = {
  title: string | null;
  traits_raw: string | null;
  price: number | string | null;
  price_usd_equivalent: number | string | null;
  payload: unknown;
};

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function pageSelect<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function GET() {
  let supabase;
  try {
    supabase = createClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "supabase" },
      { status: 500 },
    );
  }

  try {
    const [mmRows, feedleRows] = await Promise.all([
      pageSelect<MmRow>((from, to) =>
        supabase
          .from("market_listings")
          .select(
            "title, cached_traits, norm_traits, price, price_usd_equivalent, species",
          )
          .eq("current_status", "live")
          .eq("is_group_lot", false)
          .in("species", ["crested", "unknown"])
          .range(from, to),
      ),
      pageSelect<FeedleRow>((from, to) =>
        supabase
          .from("cross_platform_listings")
          .select("title, traits_raw, price, price_usd_equivalent, payload")
          .eq("platform", "feedle_air")
          .eq("currency", "USD")
          .eq("species", "crested")
          .range(from, to),
      ),
    ]);

    const usAsks: SourceAsk[] = [];
    for (const row of mmRows) {
      if (looksLikeNonCrested(row.title)) continue;
      const price = num(row.price_usd_equivalent) ?? num(row.price);
      if (price == null) continue;
      // One ask per trait pair the listing implies, not one per listing: a
      // three-trait animal contributes to each of its pairs.
      for (const combo of combosFromListing(row.cached_traits || row.norm_traits)) {
        usAsks.push({
          comboId: combo.id,
          comboDisplay: combo.display,
          priceUsd: price,
        });
      }
    }

    const krAsks: SourceAsk[] = [];
    for (const row of feedleRows) {
      if (payloadFlaggedGroupLot(row.payload)) continue;
      if (payloadIsSold(row.payload)) continue;
      const price = num(row.price) ?? num(row.price_usd_equivalent);
      if (price == null) continue;
      for (const combo of combosFromListing(row.traits_raw)) {
        krAsks.push({
          comboId: combo.id,
          comboDisplay: combo.display,
          priceUsd: price,
        });
      }
    }

    const rows = buildSourceArbRows(krAsks, usAsks).slice(0, 10);
    if (rows.length === 0) {
      return NextResponse.json(
        {
          axis: "source",
          rows: [],
          kpis: { biggestPct: 0, avgPct: 0, opportunities: 0 },
          kr_n: krAsks.length,
          us_n: usAsks.length,
          min_n: SOURCE_ARB_MIN_N,
          generated_at: new Date().toISOString(),
          empty_reason:
            krAsks.length === 0
              ? "no priced Feedle Air crested listing carried a usable trait pair"
              : usAsks.length === 0
                ? "no live MorphMarket listing carried a usable trait pair"
                : `no trait pair had at least ${SOURCE_ARB_MIN_N} asks on both sides`,
          attribution_note:
            `Ask vs ask, over every trait pair both sources list (not just a ` +
            `curated set). ${KR_LABEL} is a scheduled Korea-to-US import lot, ` +
            `not a MorphMarket click-buy. ${US_LABEL} uses current_status=live; ` +
            `last_seen_at is only fresh for the recent API recrawl, so catalogue ` +
            `leftovers still dominate the live flag. Group lots excluded. ` +
            `Rows with n<${SOURCE_ARB_MIN_N} on either side are hidden.`,
        },
        { headers },
      );
    }

    const pcts = rows.map((r) => r.spreadPct);
    return NextResponse.json(
      {
        axis: "source",
        rows,
        kpis: {
          biggestPct: pcts[0] ?? 0,
          avgPct: pcts.reduce((a, b) => a + b, 0) / pcts.length,
          opportunities: pcts.filter((p) => p >= 10).length,
        },
        kr_n: krAsks.length,
        us_n: usAsks.length,
        min_n: SOURCE_ARB_MIN_N,
        generated_at: new Date().toISOString(),
        attribution_note:
          `Ask vs ask, median of each side, over every trait pair both sources ` +
          `list. ${KR_LABEL} USD asks vs ${US_LABEL} live asks. MorphMarket ` +
          `last_seen_at is not a live filter here: most rows flagged live have ` +
          `not been re-observed in the last 48h. Feedle Air is a scheduled ` +
          `import lot, and a pair is matched by trait name, so grade and lineage ` +
          `are not controlled for. Hidden when either side has ` +
          `n<${SOURCE_ARB_MIN_N}. Confidence is sample size only.`,
        confidence: sampleConfidence(
          Math.min(
            ...rows.map((r) => Math.min(r.low.n, r.high.n)),
          ),
        ),
      },
      { headers },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "source-arbitrage" },
      { status: 500, headers },
    );
  }
}
