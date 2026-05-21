// CSV mirror of /data/market.json.
//
// Same data, flattened to one row per transaction. Easier for breeders to
// drop into a spreadsheet without writing a JSON parser.
//
// Public, edge-cached for 10 minutes. CORS open.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchCombo } from "@/lib/market/combos";
import { classifyAge } from "@/lib/market/age";
import { classifyLineage } from "@/lib/market/lineage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 5000;

const CSV_COLUMNS = [
  "id",
  "combo_id",
  "combo_name",
  "primary_morph",
  "traits",
  "region",
  "age_class",
  "lineage_tier",
  "breeder_id",
  "breeder_name",
  "status",
  "ask_price",
  "sold_price",
  "time_on_market_days",
  "date",
] as const;

type CsvCol = (typeof CSV_COLUMNS)[number];
type Cell = string | number | null;

function csvEscape(v: Cell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(_req: NextRequest) {
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "admin" }, { status: 500 });
  }

  const { data: listings, error } = await admin
    .from("market_listings")
    .select(
      "id, price, price_usd_equivalent, cached_traits, norm_traits, maturity, weight, hatch_date, seller_id, seller_name, seller_location, current_status, first_seen_at, last_seen_at",
    )
    .in("species", ["crested", "unknown"])
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (listings ?? []).map((r) => r.id as string);
  type StatusRow = {
    listing_id: string;
    status: string;
    observed_at: string;
    days_since_first_seen: number | null;
  };
  const statusByListing = new Map<string, StatusRow>();
  if (ids.length) {
    const { data: events } = await admin
      .from("listing_status_events")
      .select("listing_id, status, observed_at, days_since_first_seen")
      .in("listing_id", ids)
      .order("observed_at", { ascending: false });
    for (const ev of ((events ?? []) as StatusRow[])) {
      if (!statusByListing.has(ev.listing_id)) statusByListing.set(ev.listing_id, ev);
    }
  }

  const lines: string[] = [];
  lines.push(CSV_COLUMNS.join(","));
  for (const r of (listings ?? []) as Array<{
    id: string;
    price: number | null;
    price_usd_equivalent: number | null;
    cached_traits: string | null;
    norm_traits: string | null;
    maturity: string | null;
    weight: number | string | null;
    hatch_date: string | null;
    seller_id: string | null;
    seller_name: string | null;
    seller_location: string | null;
    current_status: string | null;
    first_seen_at: string | null;
    last_seen_at: string | null;
  }>) {
    const combo = matchCombo(r.cached_traits ?? r.norm_traits);
    if (!combo) continue;
    const ev = statusByListing.get(r.id);
    const status = (ev?.status ?? r.current_status ?? "listed") === "sold" ? "sold" : "listed";
    const ageClass = classifyAge({
      maturity: r.maturity,
      weight: r.weight,
      hatch_date: r.hatch_date,
    });
    const lineage = classifyLineage({
      total_listings: null,
      feedback_count: null,
    });
    const row: Record<CsvCol, Cell> = {
      id: r.id,
      combo_id: combo.id,
      combo_name: combo.name,
      primary_morph: combo.traits[0],
      traits: combo.traits.join("|"),
      region: r.seller_location ?? "",
      age_class: ageClass,
      lineage_tier: lineage,
      breeder_id: r.seller_id,
      breeder_name: r.seller_name,
      status,
      ask_price: r.price_usd_equivalent ?? r.price,
      sold_price: status === "sold" ? r.price_usd_equivalent ?? r.price : null,
      time_on_market_days: ev?.days_since_first_seen ?? null,
      date: ev?.observed_at ?? r.last_seen_at ?? r.first_seen_at,
    };
    lines.push(CSV_COLUMNS.map((c) => csvEscape(row[c])).join(","));
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "inline; filename=geck-market-snapshot.csv",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
