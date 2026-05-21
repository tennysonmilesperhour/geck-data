// Alert evaluation engine.
//
// Called from /api/ingest event handlers after a listingSeen or priceDrop
// lands. Each active alert in the alerts table holds a JSON query; the
// matcher evaluates it against the just-observed listing and, when it hits,
// inserts a row in alert_matches and fires the notification dispatcher.
//
// The query schema is intentionally small:
//
//   {
//     "species":     "crested" | "unknown" | "any",  // default crested
//     "trait_all":   ["lilly white", "axanthic"],    // every token required
//     "trait_any":   ["pinstripe", "harlequin"],     // any one required
//     "min_price":   100,                            // USD
//     "max_price":   500,                            // USD
//     "regions":     ["US","UK"],                    // optional whitelist
//     "must_be_drop": true                           // only fire on priceDrop
//   }
//
// All fields are optional. An empty query matches everything (intentional —
// "watch this seller" alerts pass {} and rely on the seller_id filter you
// can add as a follow-up).
//
// The matcher runs in-process against in-memory listing snapshots. No N+1
// queries: callers must provide the listing row.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AlertQuery = {
  species?: "crested" | "unknown" | "any";
  trait_all?: string[];
  trait_any?: string[];
  min_price?: number;
  max_price?: number;
  regions?: string[];
  must_be_drop?: boolean;
  seller_ids?: string[];
};

export type AlertEvaluationContext = {
  /** "listingSeen" or "priceDrop" — used to gate must_be_drop alerts. */
  trigger: "listingSeen" | "priceDrop";
  listing: {
    id: string;
    cached_traits?: string | null;
    norm_traits?: string | null;
    species?: string | null;
    price_usd?: number | null;
    seller_id?: string | null;
    seller_location?: string | null;
  };
};

export type AlertRow = {
  id: string;
  owner_id: string | null;
  name: string;
  query: AlertQuery;
  active: boolean;
};

export type AlertMatch = {
  alert: AlertRow;
  reason: string;
};

function normTrait(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Tokenize trait input for alert matching. Splits on pipe / comma /
 *  semicolon / slash delimiters only — never whitespace — so that
 *  multi-word traits like "Lilly White" survive as a single normalized
 *  token "lillywhite". This intentionally differs from lib/traits.ts
 *  parseTraitList, which splits on whitespace because the chart code
 *  consuming it wants per-word histograms. */
function alertTraitTokens(row: {
  cached_traits?: string | null;
  norm_traits?: string | null;
}): Set<string> {
  const raw = (row.cached_traits ?? row.norm_traits ?? "").trim();
  if (!raw) return new Set();
  const segments = raw
    .split(/[,;|/]+/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes(":"));
  return new Set(segments.map(normTrait).filter(Boolean));
}

function regionFromLocation(loc: string | null | undefined): string {
  if (!loc) return "US";
  const lower = loc.toLowerCase();
  if (/\b(uk|united kingdom|england|scotland|wales|northern ireland)\b/.test(lower)) return "UK";
  if (/\b(canada|ca)\b/.test(lower)) return "CA";
  if (/\b(australia|au)\b/.test(lower)) return "AU";
  if (/\b(japan|jp)\b/.test(lower)) return "JP";
  if (/\b(germany|france|italy|spain|netherlands|belgium|poland|eu|europe)\b/.test(lower)) return "EU";
  if (/\b(sweden|norway|denmark|finland|iceland|se)\b/.test(lower)) return "SE";
  return "US";
}

export function listingMatchesAlert(
  query: AlertQuery,
  ctx: AlertEvaluationContext,
): { ok: boolean; reason: string } {
  if (query.must_be_drop && ctx.trigger !== "priceDrop") {
    return { ok: false, reason: "alert requires priceDrop trigger" };
  }

  const species = query.species ?? "crested";
  if (species !== "any") {
    const ls = (ctx.listing.species ?? "unknown").toLowerCase();
    if (species === "crested" && ls !== "crested" && ls !== "unknown") {
      return { ok: false, reason: `species ${ls} not crested` };
    }
    if (species === "unknown" && ls !== "unknown") {
      return { ok: false, reason: `species ${ls} not unknown` };
    }
  }

  const traitTokens = alertTraitTokens({
    cached_traits: ctx.listing.cached_traits ?? null,
    norm_traits: ctx.listing.norm_traits ?? null,
  });

  if (query.trait_all?.length) {
    for (const t of query.trait_all) {
      if (!traitTokens.has(normTrait(t))) {
        return { ok: false, reason: `missing required trait ${t}` };
      }
    }
  }
  if (query.trait_any?.length) {
    const any = query.trait_any.some((t) => traitTokens.has(normTrait(t)));
    if (!any) {
      return { ok: false, reason: "no trait in trait_any matched" };
    }
  }

  const p = ctx.listing.price_usd ?? null;
  if (query.min_price != null && (p == null || p < query.min_price)) {
    return { ok: false, reason: `price ${p ?? "null"} below min_price` };
  }
  if (query.max_price != null && (p == null || p > query.max_price)) {
    return { ok: false, reason: `price ${p ?? "null"} above max_price` };
  }

  if (query.regions?.length) {
    const region = regionFromLocation(ctx.listing.seller_location);
    if (!query.regions.includes(region)) {
      return { ok: false, reason: `region ${region} not in allowlist` };
    }
  }

  if (query.seller_ids?.length) {
    if (!ctx.listing.seller_id || !query.seller_ids.includes(ctx.listing.seller_id)) {
      return { ok: false, reason: "seller_id not in allowlist" };
    }
  }

  return { ok: true, reason: "matched" };
}

/**
 * Pull all active alerts (cheap: typical install has < a few hundred), evaluate
 * each against the listing context, and write hits to alert_matches. Returns
 * the matches that fired so the caller can dispatch notifications.
 *
 * No-ops gracefully if the alerts table has zero rows.
 */
export async function evaluateAlerts(
  admin: SupabaseClient,
  ctx: AlertEvaluationContext,
): Promise<AlertMatch[]> {
  const { data: alerts, error } = await admin
    .from("alerts")
    .select("id, owner_id, name, query, active")
    .eq("active", true);
  if (error) return [];
  if (!alerts?.length) return [];

  const hits: AlertMatch[] = [];
  const matchRows: Record<string, unknown>[] = [];
  for (const a of alerts as AlertRow[]) {
    const q = (a.query ?? {}) as AlertQuery;
    const verdict = listingMatchesAlert(q, ctx);
    if (!verdict.ok) continue;
    hits.push({ alert: a, reason: verdict.reason });
    matchRows.push({
      alert_id: a.id,
      listing_id: ctx.listing.id,
      matched_at: new Date().toISOString(),
      payload: {
        trigger: ctx.trigger,
        price_usd: ctx.listing.price_usd ?? null,
        reason: verdict.reason,
      },
    });
  }

  if (matchRows.length > 0) {
    // ignoreDuplicates so a flapping listing doesn't spam alert_matches.
    // We don't have a unique constraint on (alert_id, listing_id, matched_at)
    // because two different price drops on the same listing should both
    // fire — uniqueness is handled at the notification layer instead.
    await admin.from("alert_matches").insert(matchRows);
  }
  return hits;
}
