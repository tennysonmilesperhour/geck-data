// Public market analytics snapshot, served as JSON at /data/market.json.
//
// geck-inspect's src/lib/marketAnalytics/queries.js fetches this URL on first
// load and falls back to mock fixtures if it 404s or returns the wrong shape.
// The shape is documented at the top of that file; we mirror it here so the
// front-end can treat live and preview snapshots identically.
//
// Strategy: derive transactions from market_listings + listing_status_events
// + price_history. Map free-text traits to the canonical combos via a small
// in-process matcher (the canonical combo list is duplicated below to avoid
// taking a runtime dependency on the geck-inspect package). We leave
// supply_pipeline / demand_signals / market_events as empty arrays / objects
// when no internal data exists; geck-inspect renders empty states gracefully.
//
// Cached at the edge for 5 minutes via Cache-Control. The full table scan is
// bounded by SNAPSHOT_LISTING_LIMIT so we don't accidentally serve a 50MB
// response if market_listings grows unexpectedly.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNAPSHOT_LISTING_LIMIT = 5000;

// Canonical combos — must stay in lockstep with geck-inspect's
// src/lib/marketAnalytics/taxonomy.js. Trait order in `traits` is irrelevant;
// the matcher does set-based comparison.
const HIGH_VALUE_COMBOS: Array<{ id: string; name: string; traits: string[] }> = [
  { id: "lw-axa",       name: "Lilly White x Axanthic",        traits: ["Lilly White", "Axanthic"] },
  { id: "lw-cap",       name: "Lilly White x Cappuccino",      traits: ["Lilly White", "Cappuccino"] },
  { id: "cap-pin",      name: "Cappuccino x Full Pinstripe",   traits: ["Cappuccino", "Full Pinstripe"] },
  { id: "axa-pin",      name: "Axanthic x Full Pinstripe",     traits: ["Axanthic", "Full Pinstripe"] },
  { id: "sable-harl",   name: "Sable x Extreme Harlequin",     traits: ["Sable", "Extreme Harlequin"] },
  { id: "frap-pin",     name: "Frappuccino x Pinstripe",       traits: ["Frappuccino", "Pinstripe"] },
  { id: "moonglow-dal", name: "Moonglow x Super Dalmatian",    traits: ["Moonglow", "Super Dalmatian"] },
  { id: "lw-soft",      name: "Lilly White x Soft Scale",      traits: ["Lilly White", "Soft Scale"] },
  { id: "axa-harl",     name: "Axanthic x Extreme Harlequin",  traits: ["Axanthic", "Extreme Harlequin"] },
  { id: "cap-dal",      name: "Cappuccino x Super Dalmatian",  traits: ["Cappuccino", "Super Dalmatian"] },
];

function normTrait(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function traitTokens(input: unknown): Set<string> {
  if (Array.isArray(input)) return new Set(input.map((t) => normTrait(String(t))));
  if (typeof input === "string") {
    return new Set(
      input.split(/[,;|/]+|\s+/).map((t) => normTrait(t)).filter(Boolean),
    );
  }
  return new Set();
}
function matchCombo(traits: unknown): { id: string; name: string; traits: string[] } | null {
  const tokens = traitTokens(traits);
  if (tokens.size === 0) return null;
  for (const c of HIGH_VALUE_COMBOS) {
    const need = c.traits.map(normTrait);
    if (need.every((n) => tokens.has(n))) return c;
  }
  return null;
}

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

function ageClassFromMaturity(mat: string | null | undefined): string {
  if (!mat) return "subadult";
  const m = mat.toLowerCase();
  if (m.includes("hatch") || m.includes("baby")) return "hatchling";
  if (m.includes("juven")) return "juvenile";
  if (m.includes("sub")) return "subadult";
  if (m.includes("adult")) return "adult";
  if (m.includes("breed")) return "proven_breeder";
  return "subadult";
}

type ListingRow = {
  id: string;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  cached_traits: unknown;
  norm_traits: unknown;
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

export async function GET(_req: NextRequest) {
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const generatedAt = new Date().toISOString();

  // 1. Pull recent listings. Sort by last_seen_at desc so the most active
  //    rows fill the bounded window even when older listings outnumber them.
  const { data: listings, error: lErr } = (await admin
    .from("market_listings")
    .select(
      "id, title, price, price_usd_equivalent, cached_traits, norm_traits, seller_id, seller_name, seller_location, current_status, first_listed_at, first_seen_at, last_seen_at",
    )
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(SNAPSHOT_LISTING_LIMIT)) as { data: ListingRow[] | null; error: { message: string } | null };

  if (lErr) {
    return NextResponse.json({ error: `listings: ${lErr.message}` }, { status: 500 });
  }

  // 2. Pull status events for the listings we returned, so we can assign
  //    each transaction the correct sold/listed status and compute time on
  //    market.
  const ids = (listings ?? []).map((r) => r.id);
  let statusByListing = new Map<string, StatusEventRow>();
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
      // First entry per listing wins because we sort observed_at desc.
      if (!statusByListing.has(ev.listing_id)) statusByListing.set(ev.listing_id, ev);
    }
  }

  // 3. Build transactions. Drop listings without a recognizable combo so the
  //    snapshot stays useful for the analytics combos page; non-combo
  //    listings still surface in the raw market_listings table for any
  //    consumer that wants them.
  const transactions = [];
  for (const r of listings ?? []) {
    const combo = matchCombo(r.cached_traits ?? r.norm_traits);
    if (!combo) continue;
    const ev = statusByListing.get(r.id);
    const status = (ev?.status ?? r.current_status ?? "listed") === "sold" ? "sold" : "listed";
    const date =
      ev?.observed_at ?? r.last_seen_at ?? r.first_seen_at ?? r.first_listed_at ?? generatedAt;
    transactions.push({
      id: r.id,
      combo_id: combo.id,
      combo_name: combo.name,
      traits: combo.traits,
      primary_morph: combo.traits[0],
      region: regionFromLocation(r.seller_location),
      age_class: ageClassFromMaturity(null),
      lineage_tier: "regional_known",
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

  // 4. Breeders. Distinct sellers from the windowed listings.
  const breederMap = new Map<string, { id: string; name: string; tier: string; region: string }>();
  for (const r of listings ?? []) {
    if (!r.seller_id) continue;
    if (breederMap.has(r.seller_id)) continue;
    breederMap.set(r.seller_id, {
      id: r.seller_id,
      name: r.seller_name ?? r.seller_id,
      tier: "regional_known",
      region: regionFromLocation(r.seller_location),
    });
  }

  // 5. Show mentions become market_events.
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
      // Snapshot is rebuilt cheaply; 5 minutes balances staleness vs DB load.
      // SWR keeps users on a slightly stale snapshot while we revalidate.
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
