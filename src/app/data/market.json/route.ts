// Public market analytics snapshot, served as JSON at /data/market.json.
//
// geck-inspect's src/lib/marketAnalytics/queries.js fetches this URL on first
// load and falls back to mock fixtures if it 404s or returns the wrong shape.
// The shape is documented at the top of that file; we mirror it here so the
// front-end can treat live and preview snapshots identically.
//
// Strategy: derive transactions from market_listings + listing_status_events
// + price_history. Map free-text traits to the canonical combos via the
// shared matcher in lib/market/combos.ts. Hydrate breeders with seller
// reputation so lineage tiers reflect reality rather than a hardcoded value.
//
// Cached at the edge for 5 minutes via Cache-Control. The full table scan is
// bounded by SNAPSHOT_LISTING_LIMIT so we don't accidentally serve a 50MB
// response if market_listings grows unexpectedly.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchCombo } from "@/lib/market/combos";
import { classifyAge, type AgeClass } from "@/lib/market/age";
import { classifyLineage, type LineageTier } from "@/lib/market/lineage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNAPSHOT_LISTING_LIMIT = 5000;

function regionFromLocation(loc: string | null | undefined): string {
  if (!loc) return "US";
  const lower = loc.toLowerCase();
  if (/\b(uk|united kingdom|england|scotland|wales|northern ireland)\b/.test(lower)) return "UK";
  if (/\b(usa|united states|us|america)\b/.test(lower) || /, ?[a-z]{2}$/i.test(loc)) return "US";
  if (/\b(canada|ca)\b/.test(lower)) return "CA";
  if (/\b(australia|au)\b/.test(lower)) return "AU";
  if (/\b(japan|jp)\b/.test(lower)) return "JP";
  if (/\b(sweden|norway|denmark|finland|iceland|se)\b/.test(lower)) return "SE";
  if (/\b(germany|france|italy|spain|netherlands|belgium|poland|eu|europe)\b/.test(lower)) return "EU";
  return "US";
}

// Translate internal vocabularies into the codes geck-inspect's market
// analytics taxonomy filters on (see geck-inspect/src/lib/marketAnalytics
// /taxonomy.js AGE_CLASSES / LINEAGE_TIERS). If the published snapshot
// uses any other code string the filter dropdowns silently exclude every
// row, which was the original cause of the empty drill-downs.
function ageClassForSnapshot(internal: AgeClass, sex: string | null | undefined): string {
  switch (internal) {
    case "hatchling":     return "baby";
    case "juvenile":      return "juvenile";
    case "subadult":      return "subadult";
    case "adult":         return "adult";
    case "proven_breeder": {
      const s = (sex ?? "").toLowerCase();
      if (s.startsWith("f")) return "proven_f";
      if (s.startsWith("m")) return "proven_m";
      // Default proven animals to female since they command the largest
      // premium and the consumer's price_multiplier ladder treats
      // proven_f as the strongest signal.
      return "proven_f";
    }
    default:              return "unknown";
  }
}

// market_listings stores birth as separate y/m/d ints, not a hatch_date
// column. Stitch a YYYY-MM-DD string when at least the year is set so
// classifyAge() can still fall back to it; otherwise let it return
// "unknown".
function hatchDateFromParts(
  y: number | null,
  m: number | null,
  d: number | null,
): string | null {
  if (!y) return null;
  const month = m ?? 1;
  const day = d ?? 1;
  const yyyy = String(y).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function lineageTierForSnapshot(internal: LineageTier): string {
  switch (internal) {
    case "foundational":    return "og_line";
    case "proven_breeder":  return "named";
    case "regional_known":  return "regional_known";
    case "emerging":        return "hobby";
    default:                return "unknown";
  }
}

type ListingRow = {
  id: string;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  cached_traits: unknown;
  norm_traits: unknown;
  maturity: string | null;
  weight: number | string | null;
  birth_year: number | null;
  birth_month: number | null;
  birth_day: number | null;
  sex: string | null;
  seller_id: string | null;
  seller_name: string | null;
  seller_location: string | null;
  current_status: string | null;
  first_listed_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type StatusEventRow = {
  listing_id: string;
  status: string;
  observed_at: string;
  days_since_first_seen: number | null;
};

type SellerRow = {
  seller_id: string;
  seller_name: string | null;
  seller_location: string | null;
  feedback_count: number | null;
  seller_rating_score: number | null;
  total_listings: number | null;
  membership: string | null;
};

export async function GET(_req: NextRequest) {
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const generatedAt = new Date().toISOString();

  // 1. Pull recent crested listings only. Geck Inspect is crested-gecko-first;
  //    other species (leopards, gargoyles, etc.) get ingested and archived
  //    via migration 0010 but never surface in user-facing analytics. The
  //    'unknown' default applies to legacy rows ingested before 0010.
  const { data: listings, error: lErr } = (await admin
    .from("market_listings")
    .select(
      "id, title, price, price_usd_equivalent, cached_traits, norm_traits, maturity, weight, birth_year, birth_month, birth_day, sex, seller_id, seller_name, seller_location, current_status, first_listed_at, first_seen_at, last_seen_at",
    )
    .in("species", ["crested", "unknown"])
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(SNAPSHOT_LISTING_LIMIT)) as { data: ListingRow[] | null; error: { message: string } | null };

  if (lErr) {
    return NextResponse.json({ error: `listings: ${lErr.message}` }, { status: 500 });
  }

  // 2. Pull status events for the listings we returned, so we can assign
  //    each transaction the correct sold/listed status and compute time on
  //    market.
  const ids = (listings ?? []).map((r) => r.id);
  const statusByListing = new Map<string, StatusEventRow>();
  if (ids.length) {
    const { data: events } = (await admin
      .from("listing_status_events")
      .select("listing_id, status, observed_at, days_since_first_seen")
      .in("listing_id", ids)
      .order("observed_at", { ascending: false })) as {
      data: StatusEventRow[] | null;
      error: { message: string } | null;
    };
    for (const ev of events ?? []) {
      if (!statusByListing.has(ev.listing_id)) statusByListing.set(ev.listing_id, ev);
    }
  }

  // 3. Hydrate seller reputation for lineage tier classification. One query
  //    over all seller ids in the snapshot; the cardinality is at most a few
  //    hundred for a 5000-listing window.
  const sellerIds = Array.from(
    new Set((listings ?? []).map((r) => r.seller_id).filter((id): id is string => !!id)),
  );
  const sellerById = new Map<string, SellerRow>();
  const soldCountById = new Map<string, number>();
  if (sellerIds.length) {
    const { data: sellers } = (await admin
      .from("market_sellers")
      .select("seller_id, seller_name, seller_location, feedback_count, seller_rating_score, total_listings, membership")
      .in("seller_id", sellerIds)) as { data: SellerRow[] | null; error: { message: string } | null };
    for (const s of sellers ?? []) sellerById.set(s.seller_id, s);

    // Sold-in-window per seller: pull sold listing_status_events that match
    // our listing set, group by seller_id via the parent listing map.
    const listingToSeller = new Map<string, string>();
    for (const r of listings ?? []) {
      if (r.seller_id) listingToSeller.set(r.id, r.seller_id);
    }
    for (const ev of statusByListing.values()) {
      if (ev.status !== "sold") continue;
      const sid = listingToSeller.get(ev.listing_id);
      if (sid) soldCountById.set(sid, (soldCountById.get(sid) ?? 0) + 1);
    }
  }

  const tierFor = (sid: string | null): LineageTier => {
    if (!sid) return "unknown";
    const s = sellerById.get(sid);
    if (!s) return "unknown";
    return classifyLineage({
      feedback_count: s.feedback_count,
      seller_rating_score: s.seller_rating_score,
      total_listings: s.total_listings,
      sold_in_window: soldCountById.get(sid) ?? 0,
      membership: s.membership,
    });
  };

  // Resolve a region for the listing: prefer the listing's own seller_location
  // (often null in the scrape), then fall back to the hydrated market_sellers
  // record, then to the regionFromLocation default ("US").
  const regionForListing = (r: ListingRow): string => {
    const loc = r.seller_location ?? sellerById.get(r.seller_id ?? "")?.seller_location ?? null;
    return regionFromLocation(loc);
  };

  // 4. Build transactions. Drop listings without a recognizable combo so the
  //    snapshot stays useful for the analytics combos page; non-combo
  //    listings still surface in the raw market_listings table for any
  //    consumer that wants them. cached_traits and norm_traits are null on
  //    the majority of rows; fall through to the listing title so the
  //    combo matcher has something to chew on.
  const transactions = [];
  for (const r of listings ?? []) {
    const combo =
      matchCombo(r.cached_traits) ??
      matchCombo(r.norm_traits) ??
      matchCombo(r.title);
    if (!combo) continue;
    const ev = statusByListing.get(r.id);
    const status = (ev?.status ?? r.current_status ?? "listed") === "sold" ? "sold" : "listed";
    const date =
      ev?.observed_at ?? r.last_seen_at ?? r.first_seen_at ?? r.first_listed_at ?? generatedAt;
    const internalAge = classifyAge({
      maturity: r.maturity,
      weight: r.weight,
      hatch_date: hatchDateFromParts(r.birth_year, r.birth_month, r.birth_day),
    });
    transactions.push({
      id: r.id,
      combo_id: combo.id,
      combo_name: combo.name,
      traits: combo.traits,
      primary_morph: combo.traits[0],
      region: regionForListing(r),
      age_class: ageClassForSnapshot(internalAge, r.sex),
      lineage_tier: lineageTierForSnapshot(tierFor(r.seller_id)),
      breeder_id: r.seller_id ?? "unknown",
      breeder_name: r.seller_name ?? "Unknown",
      status,
      ask_price: r.price ?? r.price_usd_equivalent ?? null,
      sold_price: status === "sold" ? r.price ?? r.price_usd_equivalent ?? null : null,
      time_on_market_days: ev?.days_since_first_seen ?? null,
      date,
      source_id: "external.morphmarket",
    });
  }

  // 5. Breeders. Distinct sellers from the windowed listings, with real tier
  //    mapped to the consumer's taxonomy.
  const breederMap = new Map<string, { id: string; name: string; tier: string; region: string }>();
  for (const r of listings ?? []) {
    if (!r.seller_id) continue;
    if (breederMap.has(r.seller_id)) continue;
    breederMap.set(r.seller_id, {
      id: r.seller_id,
      name: r.seller_name ?? r.seller_id,
      tier: lineageTierForSnapshot(tierFor(r.seller_id)),
      region: regionForListing(r),
    });
  }

  // 6. Show mentions become market_events.
  const { data: shows } = await admin
    .from("show_mentions")
    .select("id, show_name, show_date, source_url, observed_at")
    .order("observed_at", { ascending: false })
    .limit(50);
  const market_events = (shows ?? []).map((s) => ({
    id: String(s.id),
    name: s.show_name,
    region: "US",
    date: s.show_date ?? s.observed_at,
    impact: "low",
    kind: "expo",
    source_id: "external.show_mentions",
  }));

  const body = {
    version: 1,
    generated_at: generatedAt,
    transactions,
    breeders: [...breederMap.values()],
    supply_pipeline: [],
    demand_signals: {},
    market_events,
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
