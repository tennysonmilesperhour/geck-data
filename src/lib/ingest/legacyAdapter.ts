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
//
// The animal response sometimes omits a numeric `id` at the top level and
// carries only the string `key` slug — fall back to that so we don't silently
// drop the event (which manifests as parseEnvelopes returning [] and the
// whole POST 400'ing with "no valid events in body").
function flattenAnimal(data: Record<string, unknown>): Record<string, unknown> {
  const owner = obj(data.owner);
  const auction = obj(data.auction);
  const images = Array.isArray(data.images) ? data.images : [];
  const firstImageSrc = images.length ? obj(images[0])?.image : undefined;

  return compact({
    id: asId(data.id) ?? asId(data.key),
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
      // Last-resort fallback: if neither data.id nor data.key yielded an id,
      // use the envelope's payload.key. Mirrors what seller_profile /
      // price_drop / inferred_sold / cross_platform already do.
      const id = flat.id ?? key;
      if (!id) return [];

      const envelopes: EventEnvelope[] = [
        wrap("listingSeen", { ...flat, id, first_listed_at: isoOrUndef(data.first_listed) }, capturedAt),
      ];

      // Emit one listingImage event per image. The animal payload already
      // includes the full gallery; previously single-image listings produced
      // no image record at all because the extension's separate `gallery`
      // event was gated on `images.length > 1`. Going through the canonical
      // event handler means server-side fetch + Supabase Storage upload
      // happen automatically, regardless of whether the extension also sends
      // a gallery event.
      const images = Array.isArray(data.images) ? data.images : [];
      for (const img of images) {
        const imgObj = obj(img);
        const url = str(imgObj?.image) ?? str(imgObj?.url);
        if (!url) continue;
        envelopes.push(
          wrap(
            "listingImage",
            compact({
              listing_id: String(id),
              image_url: url,
              caption: str(imgObj?.caption),
            }),
            capturedAt,
          ),
        );
      }

      // Lineage: dams + sires arrays carry parent listing references when the
      // breeder linked them on MorphMarket. Fan out into a single
      // listingLineage event so events.ts can write to listing_lineage.
      const dams = Array.isArray(data.dams) ? data.dams : [];
      const sires = Array.isArray(data.sires) ? data.sires : [];
      const parents: Array<Record<string, unknown>> = [];
      for (const d of dams) {
        const o = obj(d);
        if (!o) continue;
        parents.push(
          compact({
            role: "dam",
            parent_id: asId(o.id) ?? asId(o.key),
            parent_label: str(o.title) ?? str(o.clean_title) ?? str(o.name),
            parent_traits: o.cached_traits ?? o.traits,
            parent_url: str(o.path) ?? str(o.share_url),
          }),
        );
      }
      for (const s of sires) {
        const o = obj(s);
        if (!o) continue;
        parents.push(
          compact({
            role: "sire",
            parent_id: asId(o.id) ?? asId(o.key),
            parent_label: str(o.title) ?? str(o.clean_title) ?? str(o.name),
            parent_traits: o.cached_traits ?? o.traits,
            parent_url: str(o.path) ?? str(o.share_url),
          }),
        );
      }
      if (parents.length) {
        envelopes.push(
          wrap(
            "listingLineage",
            { listing_id: String(id), parents },
            capturedAt,
          ),
        );
      }

      return envelopes;
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
            listing_id: asId(data.listing_key) ?? asId(data.key) ?? key,
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
      const out: EventEnvelope[] = [
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

      // Fan out images. The crossPlatform handler upserts the parent listing,
      // so by the time these events run the FK target exists. Each image
      // triggers a server-side fetch + storage upload via
      // handleCrossPlatformImage.
      const images = Array.isArray(data.images) ? data.images : [];
      for (const img of images) {
        const url = typeof img === "string" ? img : str(obj(img)?.url);
        if (!url) continue;
        out.push(
          wrap(
            "crossPlatformImage",
            compact({
              platform,
              external_id: externalId,
              image_url: url,
              caption: typeof img === "string" ? undefined : str(obj(img)?.caption),
            }),
            capturedAt,
          ),
        );
      }
      return out;
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

    case "auction": {
      // Mid-auction snapshot. auction_outcome covers the close; this covers
      // bid count / current price progress while the auction is still live.
      const listingId = asId(data.listing_key) ?? asId(data.key) ?? key;
      if (!listingId) return [];
      return [
        wrap(
          "auctionState",
          compact({
            listing_id: listingId,
            current_price: data.current_price ?? data.price,
            current_price_usd: data.current_price_usd ?? data.price_usd_equivalent,
            currency: data.currency,
            bid_count: data.bid_count,
            ends_at: isoOrUndef(data.end_time),
          }),
          capturedAt,
        ),
      ];
    }

    case "lineage": {
      // Lineage events come from the dedicated lineage scrape (parents
      // reachable from the listing detail page even when the animal payload
      // didn't include dams/sires inline). Shape: { key, parents: [{ role,
      // id|label, traits, url }, ...] }.
      const listingId = asId(data.key) ?? key;
      if (!listingId) return [];
      const parents = Array.isArray(data.parents) ? data.parents : [];
      const cleaned: Array<Record<string, unknown>> = [];
      for (const p of parents) {
        const o = obj(p);
        if (!o) continue;
        const role = str(o.role);
        if (!role || !["dam", "sire", "parent"].includes(role)) continue;
        cleaned.push(
          compact({
            role,
            parent_id: asId(o.parent_id) ?? asId(o.id) ?? asId(o.key),
            parent_label: str(o.parent_label) ?? str(o.label) ?? str(o.title),
            parent_traits: o.parent_traits ?? o.traits,
            parent_url: str(o.parent_url) ?? str(o.url) ?? str(o.path),
          }),
        );
      }
      if (!cleaned.length) return [];
      return [
        wrap(
          "listingLineage",
          { listing_id: listingId, parents: cleaned },
          capturedAt,
        ),
      ];
    }

    case "gallery": {
      const images = Array.isArray(data.images) ? data.images : [];
      const listingId = asId(data.key) ?? key;
      if (!listingId || images.length === 0) return [];
      const out: EventEnvelope[] = [];
      for (const img of images) {
        const imgObj = obj(img);
        const url = str(imgObj?.url);
        if (!url) continue;
        out.push(
          wrap(
            "listingImage",
            compact({
              listing_id: listingId,
              image_url: url,
              caption: str(imgObj?.caption),
            }),
            capturedAt,
          ),
        );
      }
      return out;
    }

    default:
      return [];
  }
}
