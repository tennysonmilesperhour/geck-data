// Translation layer for the browser extension's legacy event shape.
//
// The extension (github.com/tennysonmilesperhour/eyeinthesky, as of v4.10)
// predates the canonical event schema that events.ts handles. It POSTs
// envelopes like:
//
//     { type: 'animal',
//       payload: { key: '...', data: { ...actual fields... }, captured_at: '...' } }
//
// — the real listing fields are nested under payload.data, and the type
// names are different (`animal` / `listings_page` / `price_drop` /
// `inferred_sold` / `auction_outcome` / `seller_profile` / `cross_platform` /
// `show_mentions`). `parseEnvelopes` previously rejected every one of these
// because `type` wasn't in the canonical whitelist, so every POST returned
// 400 and no data ever landed in Supabase.
//
// This module recognises the legacy shape and returns 0..N canonical
// envelopes. A legacy event can produce zero envelopes (unsupported type,
// e.g. `lineage` / `gallery`) or multiple (one `show_mentions` event carries
// an array of shows — we fan out one `showMention` per entry).
//
// We deliberately preserve the extension as-is and do the translation on the
// server: this lets existing installations start working immediately on the
// next deploy, without an extension re-release.

import type { EventEnvelope, EventType } from "./events";

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asId(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function isoOrUndef(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

// Strip undefined values so downstream upserts don't overwrite existing
// columns with null. events.ts's handlers do `payload[k] ?? null`, which
// turns a *present but undefined* key into an explicit null write.
function compact(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function wrap(
  type: EventType,
  payload: Record<string, unknown>,
  occurred_at?: string,
): EventEnvelope {
  return { type, payload, occurred_at, source: "extension_legacy" };
}

// Flatten the MorphMarket animal/listing response into the columns
// market_listings accepts. Only fields we can confidently map are included.
function flattenAnimal(data: Record<string, unknown>): Record<string, unknown> {
  const owner = obj(data.owner);
  const auction = obj(data.auction);
  const images = Array.isArray(data.images) ? data.images : [];
  const firstImageSrc = images.length ? obj(images[0])?.image : undefined;

  return compact({
    id: asId(data.id),
    title: data.clean_title ?? data.title,
    description: data.desc ?? data.description,
    price: data.price,
    price_usd_equivalent: data.price_usd_equivalent ?? data.usd_price,
    currency: data.currency,
    maturity: data.maturity,
    sex: data.sex,
    weight: data.weight,
    hatch_date: data.hatch_date,
    cached_traits: data.cached_traits,
    norm_traits: data.norm_traits,
    seller_id: owner ? asId(owner.id) : undefined,
    seller_name: owner ? owner.clean_name ?? owner.name : undefined,
    seller_location: owner ? owner.location : undefined,
    url: data.path ?? data.share_url,
    image_url: firstImageSrc,
    is_auction: auction ? true : undefined,
    bid_count: auction ? auction.bid_count : undefined,
    auction_end_at: auction ? auction.end_time : undefined,
  });
}

// Flatten a single row from a listings search result.
function flattenResult(r: Record<string, unknown>): Record<string, unknown> {
  return compact({
    id: asId(r.key) ?? asId(r.id),
    title: r.title,
    price: r.price,
    price_usd_equivalent: r.price_usd_equivalent ?? r.usd_price,
    currency: r.currency,
    maturity: r.maturity,
    sex: r.sex,
    cached_traits: r.cached_traits ?? r.traits,
    norm_traits: r.norm_traits,
    seller_name: r.store_name ?? r.owner_name,
    url: r.path ?? r.share_url,
  });
}

export function adaptLegacyEvent(raw: unknown): EventEnvelope[] {
  const r = obj(raw);
  if (!r) return [];
  const type = typeof r.type === "string" ? r.type : "";
  const payload = obj(r.payload);
  if (!type || !payload) return [];

  // Most legacy events put the real fields under payload.data; price_drop /
  // inferred_sold / cross_platform also rely on payload.key as the listing id.
  const data = obj(payload.data) ?? {};
  const capturedAt = isoOrUndef(payload.captured_at);
  const key = asId(payload.key);

  switch (type) {
    case "animal": {
      const flat = flattenAnimal(data);
      if (!flat.id) return [];
      return [wrap("listingSeen", flat, capturedAt)];
    }

    case "listings_page":
    case "sold_listings":
    case "trait_listings":
    case "store_listings": {
      const results = Array.isArray(data.results) ? data.results : [];
      const listings = results
        .map((item) => (obj(item) ? flattenResult(obj(item)!) : null))
        .filter((v): v is Record<string, unknown> => !!v && typeof v.id === "string");
      if (!listings.length) return [];
      return [wrap("searchResultBatch", { listings }, capturedAt)];
    }

    case "price_drop": {
      const listingId = asId(data.key) ?? key;
      if (!listingId) return [];
      return [
        wrap(
          "priceDrop",
          compact({
            listing_id: listingId,
            old_price: data.previous_price,
            new_price: data.new_price,
          }),
          capturedAt,
        ),
      ];
    }

    case "inferred_sold": {
      const listingId = asId(data.key) ?? key;
      if (!listingId) return [];
      return [wrap("soldInferred", { listing_id: listingId }, capturedAt)];
    }

    case "auction_outcome": {
      return [
        wrap(
          "auctionClose",
          compact({
            listing_id: asId(data.listing_key),
            final_price: data.final_price,
            bid_count: data.bid_count,
            closed_at: isoOrUndef(data.end_time),
          }),
          capturedAt,
        ),
      ];
    }

    case "seller_profile": {
      const sellerId = asId(data.id) ?? key;
      if (!sellerId) return [];
      return [
        wrap(
          "sellerSnapshot",
          compact({
            seller_id: sellerId,
            seller_name: data.clean_name ?? data.name,
            seller_location: data.location,
            membership: data.membership,
            feedback_count: data.feedback_count,
            seller_rating_score: data.seller_rating_score,
            five_star_rating: data.five_star_rating,
            total_listings: data.total_listings,
            avg_price: data.avg_price,
          }),
          capturedAt,
        ),
      ];
    }

    case "cross_platform": {
      const platform = str(data.platform);
      const externalId = asId(data.external_id) ?? key;
      if (!platform || !externalId) return [];
      return [
        wrap(
          "crossPlatform",
          compact({
            platform,
            external_id: externalId,
            title: data.title,
            description: data.description,
            price: data.price,
            price_usd_equivalent: data.price_usd_equivalent,
            currency: data.currency,
            seller_name: data.seller_name,
            seller_location: data.seller_location,
            url: data.url,
            traits_raw: data.traits_raw,
          }),
          capturedAt,
        ),
      ];
    }

    case "show_mentions": {
      const shows = Array.isArray(data.shows) ? data.shows : [];
      const listingId = asId(data.key) ?? key;
      const out: EventEnvelope[] = [];
      for (const s of shows) {
        const entry = obj(s);
        const showName = str(entry?.show);
        if (!showName) continue;
        out.push(
          wrap(
            "showMention",
            compact({
              show_name: showName,
              listing_id: asId(entry?.listing_key) ?? listingId,
            }),
            capturedAt,
          ),
        );
      }
      return out;
    }

    // Known legacy types with no canonical destination. Returning [] here
    // (rather than falling through to `default`) keeps the intent explicit:
    // we've seen them, we're choosing not to store them today.
    //   auction      — partial auction state; value arrives via auction_outcome
    //   lineage      — no destination table yet
    //   gallery      — images go through /api/upload, not /api/ingest
    case "auction":
    case "lineage":
    case "gallery":
      return [];

    default:
      return [];
  }
}
