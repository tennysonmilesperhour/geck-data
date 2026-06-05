// Public market analytics snapshot, served as JSON at /data/market.json.
//
// geck-inspect's src/lib/marketAnalytics/queries.js fetches this URL on first
// load and falls back to mock fixtures if it 404s or returns the wrong shape.
// The shape is documented at the top of that file; we mirror it here so the
// front-end can treat live and preview snapshots identically.
//
// Strategy: emit *every* recent priced crested listing, not just the handful
// whose traits happen to resolve to a high-value combo. We read the canonical
// market_listings table (it carries seller_id, seller_location, USD-normalized
// price and the species tag) and LEFT JOIN the richer listings table in JS
// (it carries trait_array on 6k rows and sold_at on 2k rows, versus a few
// hundred in market_listings). Sellers are hydrated from market_sellers so
// breeder attribution, region and tier reflect reality instead of "unknown".
//
// Cached at the edge for 5 minutes via Cache-Control. We page through the
// tables in 1000-row batches because PostgREST caps a single response, and
// bound the total with SNAPSHOT_LISTING_LIMIT so the payload can't balloon if
// the table grows unexpectedly.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchCombo } from "@/lib/market/combos";
import { classifyAge, type AgeClass } from "@/lib/market/age";
import { classifyLineage, type LineageTier } from "@/lib/market/lineage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Upper bound on transactions emitted. The crested window is ~9.3k rows today;
// keep generous headroom so we publish the full dataset, while still capping a
// runaway response if ingestion balloons.
const SNAPSHOT_LISTING_LIMIT = 15000;
const PAGE_SIZE = 1000;

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
  morphmarket_key: number | null;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  original_price: number | null;
  cached_traits: unknown;
  norm_traits: unknown;
  maturity: string | null;
  weight: number | string | null;
  birth_year: number | null;
  birth_month: number | null;
  birth_day: number | null;
  sex: string | null;
  proven_breeder: boolean | null;
  seller_id: string | null;
  seller_name: string | null;
  seller_location: string | null;
  current_status: string | null;
  is_sold: boolean | null;
  first_listed_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

// The richer companion row, joined on listing_id = market_listings.morphmarket_key.
type RichListingRow = {
  listing_id: string;
  name: string | null;
  traits: string | null;
  trait_array: string[] | null;
  sold_at: string | null;
  seller_slug: string | null;
  seller_name: string | null;
  maturity: string | null;
  weight_grams: number | null;
  birth_date: string | null;
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
  price_tier: string | null;
  first_seen_listing: string | null;
  morph_specialization: string | null;
};

type Queryable = ReturnType<typeof createAdminClient>;

// PostgREST returns at most a page worth of rows per request (the project's
// max-rows setting), so anything that can exceed ~1000 rows must be paged. We
// add a stable secondary sort on the caller side to keep pagination
// deterministic across requests.
async function fetchAllPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  hardCap = Infinity,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < hardCap; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, hardCap) - 1;
    const { data, error } = await build(from, to);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export async function GET(_req: NextRequest) {
  let admin: Queryable;
  try {
    admin = createAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const generatedAt = new Date().toISOString();

  try {
    // 1. Pull recent priced crested listings. Geck Inspect is
    //    crested-gecko-first; other species (leopards, gargoyles, etc.) get
    //    ingested and archived via migration 0010 but never surface in
    //    user-facing analytics. The 'unknown' default applies to legacy rows
    //    ingested before 0010. Only priced rows are useful for price analytics.
    const listings = await fetchAllPaged<ListingRow>(
      (from, to) =>
        admin
          .from("market_listings")
          .select(
            "id, morphmarket_key, title, price, price_usd_equivalent, original_price, cached_traits, norm_traits, maturity, weight, birth_year, birth_month, birth_day, sex, proven_breeder, seller_id, seller_name, seller_location, current_status, is_sold, first_listed_at, first_seen_at, last_seen_at",
          )
          .in("species", ["crested", "unknown"])
          .not("price_usd_equivalent", "is", null)
          .order("last_seen_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: ListingRow[] | null;
          error: { message: string } | null;
        }>,
      SNAPSHOT_LISTING_LIMIT,
    );

    // 2. Pull the richer companion rows and key them by listing_id, which maps
    //    to market_listings.morphmarket_key. This is where trait_array (6k
    //    rows) and sold_at (2k rows) live, far beyond what market_listings
    //    carries on its own. We page the whole table; it's the same order of
    //    magnitude as the listings window.
    const richRows = await fetchAllPaged<RichListingRow>(
      (from, to) =>
        admin
          .from("listings")
          .select(
            "listing_id, name, traits, trait_array, sold_at, seller_slug, seller_name, maturity, weight_grams, birth_date",
          )
          .order("listing_id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: RichListingRow[] | null;
          error: { message: string } | null;
        }>,
      SNAPSHOT_LISTING_LIMIT,
    );
    const richByKey = new Map<string, RichListingRow>();
    for (const rr of richRows) richByKey.set(rr.listing_id, rr);
    const richFor = (r: ListingRow): RichListingRow | undefined =>
      r.morphmarket_key != null ? richByKey.get(String(r.morphmarket_key)) : undefined;

    // 3. Status events are a small table (status transitions only). Pull them
    //    all and keep the most recent per listing as a supplementary status /
    //    time-on-market signal; listings.sold_at remains the primary sold cue.
    const statusByListing = new Map<string, StatusEventRow>();
    const statusEvents = await fetchAllPaged<StatusEventRow>(
      (from, to) =>
        admin
          .from("listing_status_events")
          .select("listing_id, status, observed_at, days_since_first_seen")
          .order("observed_at", { ascending: false })
          .range(from, to) as unknown as PromiseLike<{
          data: StatusEventRow[] | null;
          error: { message: string } | null;
        }>,
    );
    for (const ev of statusEvents) {
      if (!statusByListing.has(ev.listing_id)) statusByListing.set(ev.listing_id, ev);
    }

    // 4. Hydrate all sellers. market_sellers (~900) feeds both per-transaction
    //    breeder attribution and the top-level breeders[] array the consumer's
    //    Breeders view depends on.
    const sellerRows = await fetchAllPaged<SellerRow>(
      (from, to) =>
        admin
          .from("market_sellers")
          .select(
            "seller_id, seller_name, seller_location, feedback_count, seller_rating_score, total_listings, membership, price_tier, first_seen_listing, morph_specialization",
          )
          .order("seller_id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: SellerRow[] | null;
          error: { message: string } | null;
        }>,
    );
    const sellerById = new Map<string, SellerRow>();
    for (const s of sellerRows) sellerById.set(s.seller_id, s);

    // Per-seller sold-in-window count, used by the lineage classifier.
    const soldCountById = new Map<string, number>();

    // Resolve a stable breeder id for a listing: prefer market_listings.seller_id,
    // fall back to the richer listings.seller_slug. Either form also keys
    // market_sellers, so attribution and lookups stay consistent.
    const breederIdFor = (r: ListingRow): string | null =>
      r.seller_id ?? richFor(r)?.seller_slug ?? null;

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

    // Region for a listing: prefer the listing's own seller_location, then the
    // hydrated market_sellers record, then the regionFromLocation default.
    const regionForListing = (r: ListingRow, bid: string | null): string => {
      const loc = r.seller_location ?? (bid ? sellerById.get(bid)?.seller_location : null) ?? null;
      return regionFromLocation(loc);
    };

    // First pass: pre-compute sold counts per seller so the lineage classifier
    // sees recent activity. A row is sold if any of its signals say so.
    const isSold = (r: ListingRow): boolean => {
      const rr = richFor(r);
      const ev = statusByListing.get(r.id);
      return !!rr?.sold_at || r.is_sold === true || r.current_status === "sold" || ev?.status === "sold";
    };
    for (const r of listings) {
      if (!isSold(r)) continue;
      const bid = breederIdFor(r);
      if (bid) soldCountById.set(bid, (soldCountById.get(bid) ?? 0) + 1);
    }

    // 5. Build transactions. Unlike the previous generator we DO NOT drop rows
    //    that fail to resolve a high-value combo; those still carry price,
    //    region, breeder, status and age signal that the Overview, Regional
    //    and Breeders views aggregate over. combo_id/combo_name are simply
    //    null when no canonical combo matches.
    const transactions = [];
    for (const r of listings) {
      const rr = richFor(r);
      const bid = breederIdFor(r);
      const seller = bid ? sellerById.get(bid) : undefined;

      const traitArr = Array.isArray(rr?.trait_array) ? rr!.trait_array : null;
      const combo =
        matchCombo(traitArr) ??
        matchCombo(rr?.traits) ??
        matchCombo(r.norm_traits) ??
        matchCombo(r.cached_traits) ??
        matchCombo(r.title) ??
        matchCombo(rr?.name);
      const traits = combo ? combo.traits : (traitArr ?? []);
      const primary_morph = combo ? combo.traits[0] : (traits[0] ?? null);

      const ev = statusByListing.get(r.id);
      const sold = isSold(r);
      const status = sold ? "sold" : "listed";

      const soldDate = rr?.sold_at ?? (ev?.status === "sold" ? ev.observed_at : null);
      const date = sold
        ? soldDate ?? r.first_listed_at ?? r.first_seen_at ?? r.last_seen_at ?? generatedAt
        : r.first_listed_at ?? r.first_seen_at ?? r.last_seen_at ?? generatedAt;

      // Time on market for sold rows: prefer measured sold_at - first_seen_at,
      // fall back to the status event's precomputed delta.
      let time_on_market_days: number | null = ev?.days_since_first_seen ?? null;
      if (sold && soldDate && r.first_seen_at) {
        const ms = Date.parse(soldDate) - Date.parse(r.first_seen_at);
        if (Number.isFinite(ms) && ms >= 0) time_on_market_days = Math.round(ms / 86_400_000);
      }

      const internalAge = classifyAge({
        maturity: r.maturity ?? rr?.maturity,
        weight: r.weight ?? rr?.weight_grams,
        hatch_date:
          hatchDateFromParts(r.birth_year, r.birth_month, r.birth_day) ?? rr?.birth_date,
        is_breeding: r.proven_breeder,
      });

      const askPrice = r.price_usd_equivalent ?? r.price ?? r.original_price ?? null;

      transactions.push({
        id: r.id,
        combo_id: combo?.id ?? null,
        combo_name: combo?.name ?? null,
        traits,
        primary_morph,
        region: regionForListing(r, bid),
        age_class: ageClassForSnapshot(internalAge, r.sex),
        lineage_tier: lineageTierForSnapshot(tierFor(bid)),
        breeder_id: bid ?? "unknown",
        breeder_name: r.seller_name ?? seller?.seller_name ?? rr?.seller_name ?? "Unknown",
        status,
        ask_price: askPrice,
        sold_price: sold ? askPrice : null,
        time_on_market_days,
        date,
        source_id: "external.morphmarket",
      });
    }

    // 6. Breeders. Emit every hydrated seller so the consumer's Breeders view
    //    (which filters out breeder_id === 'unknown') can resolve names, tiers,
    //    regions and specialties for the attributed transactions above.
    const breeders = sellerRows.map((s) => ({
      id: s.seller_id,
      name: s.seller_name ?? s.seller_id,
      tier: s.price_tier ?? lineageTierForSnapshot(tierFor(s.seller_id)),
      region: regionFromLocation(s.seller_location),
      active_since: s.first_seen_listing ?? null,
      specialties: s.morph_specialization ?? null,
    }));

    // 7. Show mentions become market_events.
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
      breeders,
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
