// Event envelope router for the browser extension.
//
// The extension POSTs {events:[{type,payload,occurred_at?,source?},…]} to
// /api/ingest with application/json. Each event type is handled below;
// all writes use the service-role admin client.
//
// Design notes:
//   - All timestamps default to now() on the server side if the event did not
//     supply occurred_at, so the extension can be fire-and-forget.
//   - market_listings is the central table. A listingSeen event upserts core
//     fields, writes one row to price_history, one to listing_status_events
//     (status='live'), and keeps first_seen_at / last_seen_at fresh.
//   - We never trust the extension to tell us first_seen_at; we compute it
//     server-side (coalesce current value, now()).
//   - Schema validation is intentionally lightweight — we reject obviously
//     malformed envelopes, but we don't ship a validation library for v1.
import type { SupabaseClient } from "@supabase/supabase-js";
import { adaptLegacyEvent } from "./legacyAdapter";

export type EventType =
  | "listingSeen"
  | "listingDetail"
  | "searchResultBatch"
  | "priceDrop"
  | "soldInferred"
  | "auctionClose"
  | "showMention"
  | "sellerSnapshot"
  | "crossPlatform"
  | "alertMatch";

export type EventEnvelope = {
  type: EventType;
  payload: Record<string, unknown>;
  occurred_at?: string; // ISO
  source?: string;
};

export type EventResult = {
  type: EventType | "unknown";
  ok: boolean;
  detail: string;
};

const ALL_TYPES: EventType[] = [
  "listingSeen",
  "listingDetail",
  "searchResultBatch",
  "priceDrop",
  "soldInferred",
  "auctionClose",
  "showMention",
  "sellerSnapshot",
  "crossPlatform",
  "alertMatch",
];

function isEventType(s: unknown): s is EventType {
  return typeof s === "string" && (ALL_TYPES as string[]).includes(s);
}

export function parseEnvelopes(body: unknown): EventEnvelope[] {
  if (!body || typeof body !== "object") return [];
  const arr = (body as { events?: unknown }).events;
  if (!Array.isArray(arr)) return [];
  const out: EventEnvelope[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    // Canonical envelope: { type: <EventType>, payload: {...} }.
    if (
      isEventType(rec.type) &&
      rec.payload &&
      typeof rec.payload === "object"
    ) {
      out.push({
        type: rec.type,
        payload: rec.payload as Record<string, unknown>,
        occurred_at:
          typeof rec.occurred_at === "string" ? rec.occurred_at : undefined,
        source: typeof rec.source === "string" ? rec.source : undefined,
      });
      continue;
    }
    // Legacy envelope from the browser extension: different type names and
    // fields nested under payload.data. Fan out through the adapter, which
    // returns 0..N canonical envelopes.
    for (const env of adaptLegacyEvent(raw)) out.push(env);
  }
  return out;
}

type Admin = SupabaseClient;

function nowIso(): string {
  return new Date().toISOString();
}

function toIso(v: unknown, fallback: string): string {
  if (typeof v === "string" && v.length > 0) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return fallback;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}

// Columns we are willing to write to market_listings from an event. The schema
// has many more columns; we whitelist the ones the extension actually emits.
const LISTING_COLUMNS = [
  "id",
  "title",
  "description",
  "price",
  "price_usd_equivalent",
  "currency",
  "maturity",
  "sex",
  "weight",
  "hatch_date",
  "cached_traits",
  "norm_traits",
  "parentage",
  "seller_id",
  "seller_name",
  "seller_location",
  "url",
  "image_url",
  "is_auction",
  "bid_count",
  "auction_end_at",
  "created_at",
  "updated_at",
] as const;

function projectListing(payload: Record<string, unknown>): Record<string, unknown> | null {
  const id = str(payload.id) ?? str(payload.listing_id);
  if (!id) return null;
  const out: Record<string, unknown> = { id };
  for (const k of LISTING_COLUMNS) {
    if (k === "id") continue;
    if (k in payload) out[k] = payload[k] ?? null;
  }
  return out;
}

async function touchListingSeen(
  admin: Admin,
  id: string,
  observed: string,
): Promise<void> {
  // Single atomic UPDATE in Postgres (see touch_listing_seen in 0002).
  // Protects against concurrent listingSeen events racing on first/last_seen_at,
  // and preserves terminal states (sold, removed) so a late listingSeen can't
  // undo a sold inference.
  await admin.rpc("touch_listing_seen", { p_id: id, p_observed: observed });
}

// Ensure a market_listings row exists for the given id before writing any
// child row that FKs into it. Stub-only: does not overwrite existing columns.
async function ensureListingStub(admin: Admin, id: string): Promise<void> {
  await admin
    .from("market_listings")
    .upsert({ id }, { onConflict: "id", ignoreDuplicates: true });
}

async function daysSinceFirstSeen(
  admin: Admin,
  id: string,
  observed: string,
): Promise<number | null> {
  const { data } = await admin
    .from("market_listings")
    .select("first_seen_at")
    .eq("id", id)
    .maybeSingle();
  const fs = data?.first_seen_at as string | null | undefined;
  if (!fs) return null;
  const diffMs = Date.parse(observed) - Date.parse(fs);
  if (!Number.isFinite(diffMs)) return null;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

// ----- handlers -------------------------------------------------------------

async function handleListingSeen(
  admin: Admin,
  env: EventEnvelope,
): Promise<EventResult> {
  const observed = toIso(env.occurred_at, nowIso());
  const row = projectListing(env.payload);
  if (!row) return { type: env.type, ok: false, detail: "missing listing id" };

  const { error: upErr } = await admin
    .from("market_listings")
    .upsert(row, { onConflict: "id" });
  if (upErr) return { type: env.type, ok: false, detail: `listings upsert: ${upErr.message}` };

  await touchListingSeen(admin, row.id as string, observed);

  const priceRow = {
    listing_id: row.id,
    price: num(env.payload.price),
    price_usd_equivalent: num(env.payload.price_usd_equivalent),
    currency: str(env.payload.currency),
    observed_at: observed,
    source: env.source ?? "extension",
  };
  if (priceRow.price != null || priceRow.price_usd_equivalent != null) {
    await admin.from("price_history").insert(priceRow);
  }

  await admin.from("listing_status_events").upsert(
    {
      listing_id: row.id,
      status: "live",
      observed_at: observed,
      source: env.source ?? "extension_explicit",
      days_since_first_seen: await daysSinceFirstSeen(admin, row.id as string, observed),
    },
    { onConflict: "listing_id,status,observed_at", ignoreDuplicates: true },
  );

  return { type: env.type, ok: true, detail: `listing ${row.id} upserted` };
}

async function handleSearchResultBatch(
  admin: Admin,
  env: EventEnvelope,
): Promise<EventResult> {
  const observed = toIso(env.occurred_at, nowIso());
  const raw = env.payload.listings;
  const rows: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const p = projectListing(item as Record<string, unknown>);
      if (p) rows.push(p);
    }
  }
  if (rows.length === 0) {
    return { type: env.type, ok: false, detail: "no valid listings in batch" };
  }
  const { error } = await admin
    .from("market_listings")
    .upsert(rows, { onConflict: "id" });
  if (error) return { type: env.type, ok: false, detail: `batch upsert: ${error.message}` };

  // Fan out last_seen_at touch (cheap — we just update many rows in one call)
  await admin
    .from("market_listings")
    .update({ last_seen_at: observed, current_status: "live" })
    .in(
      "id",
      rows.map((r) => r.id as string),
    );
  return { type: env.type, ok: true, detail: `upserted ${rows.length} listings` };
}

async function handlePriceDrop(
  admin: Admin,
  env: EventEnvelope,
): Promise<EventResult> {
  const observed = toIso(env.occurred_at, nowIso());
  const listingId = str(env.payload.listing_id) ?? str(env.payload.id);
  if (!listingId) return { type: env.type, ok: false, detail: "missing listing id" };
  await ensureListingStub(admin, listingId);
  const oldPrice = num(env.payload.old_price);
  const newPrice = num(env.payload.new_price);
  const pct =
    oldPrice != null && newPrice != null && oldPrice > 0
      ? ((newPrice - oldPrice) / oldPrice) * 100
      : null;
  const row = {
    listing_id: listingId,
    old_price: oldPrice,
    new_price: newPrice,
    old_price_usd: num(env.payload.old_price_usd),
    new_price_usd: num(env.payload.new_price_usd),
    currency: str(env.payload.currency),
    pct_change: pct,
    observed_at: observed,
    source: env.source ?? "extension",
  };
  const { error } = await admin.from("price_drops").insert(row);
  if (error) return { type: env.type, ok: false, detail: error.message };

  if (newPrice != null) {
    await admin.from("price_history").insert({
      listing_id: listingId,
      price: newPrice,
      price_usd_equivalent: num(env.payload.new_price_usd),
      currency: str(env.payload.currency),
      observed_at: observed,
      source: env.source ?? "extension",
    });
    await admin
      .from("market_listings")
      .update({
        price: newPrice,
        price_usd_equivalent: num(env.payload.new_price_usd),
        last_seen_at: observed,
      })
      .eq("id", listingId);
  }
  return { type: env.type, ok: true, detail: `drop ${pct?.toFixed(1)}% on ${listingId}` };
}

async function handleSoldInferred(
  admin: Admin,
  env: EventEnvelope,
): Promise<EventResult> {
  const observed = toIso(env.occurred_at, nowIso());
  const listingId = str(env.payload.listing_id) ?? str(env.payload.id);
  if (!listingId) return { type: env.type, ok: false, detail: "missing listing id" };
  await ensureListingStub(admin, listingId);
  const days = await daysSinceFirstSeen(admin, listingId, observed);
  const { error } = await admin.from("listing_status_events").upsert(
    {
      listing_id: listingId,
      status: "sold",
      observed_at: observed,
      source: env.source ?? "extension_inferred",
      days_since_first_seen: days,
    },
    { onConflict: "listing_id,status,observed_at", ignoreDuplicates: true },
  );
  if (error) return { type: env.type, ok: false, detail: error.message };
  await admin
    .from("market_listings")
    .update({ current_status: "sold" })
    .eq("id", listingId);
  return {
    type: env.type,
    ok: true,
    detail: `${listingId} marked sold${days != null ? ` (${days}d)` : ""}`,
  };
}

async function handleAuctionClose(
  admin: Admin,
  env: EventEnvelope,
): Promise<EventResult> {
  const observed = toIso(env.occurred_at, nowIso());
  const listingId = str(env.payload.listing_id);
  const row = {
    listing_id: listingId,
    final_price: num(env.payload.final_price),
    final_price_usd: num(env.payload.final_price_usd),
    currency: str(env.payload.currency),
    bid_count: int(env.payload.bid_count),
    winning_bidder: str(env.payload.winning_bidder),
    closed_at: toIso(env.payload.closed_at, observed),
    observed_at: observed,
    source: env.source ?? "extension",
  };
  const { error } = await admin.from("auction_results").insert(row);
  if (error) return { type: env.type, ok: false, detail: error.message };
  if (listingId) {
    await ensureListingStub(admin, listingId);
    await admin.from("listing_status_events").upsert(
      {
        listing_id: listingId,
        status: "sold",
        observed_at: row.closed_at,
        source: "auction_close",
        days_since_first_seen: await daysSinceFirstSeen(admin, listingId, row.closed_at),
      },
      { onConflict: "listing_id,status,observed_at", ignoreDuplicates: true },
    );
    await admin
      .from("market_listings")
      .update({ current_status: "sold" })
      .eq("id", listingId);
  }
  return { type: env.type, ok: true, detail: `auction closed${listingId ? ` for ${listingId}` : ""}` };
}

async function handleShowMention(
  admin: Admin,
  env: EventEnvelope,
): Promise<EventResult> {
  const showName = str(env.payload.show_name);
  if (!showName) return { type: env.type, ok: false, detail: "missing show_name" };

  // The FKs on show_mentions are nullable but still enforced when non-null.
  // Null out ids that don't exist yet so a mention is never dropped because
  // its listing/seller hasn't been observed through another stream.
  let listingId = str(env.payload.listing_id);
  let sellerId = str(env.payload.seller_id);
  if (listingId) {
    const { data } = await admin
      .from("market_listings")
      .select("id")
      .eq("id", listingId)
      .maybeSingle();
    if (!data) listingId = null;
  }
  if (sellerId) {
    const { data } = await admin
      .from("market_sellers")
      .select("seller_id")
      .eq("seller_id", sellerId)
      .maybeSingle();
    if (!data) sellerId = null;
  }

  const row = {
    listing_id: listingId,
    seller_id: sellerId,
    show_name: showName,
    show_date: str(env.payload.show_date),
    context: str(env.payload.context),
    source_url: str(env.payload.source_url),
    observed_at: toIso(env.occurred_at, nowIso()),
  };
  const { error } = await admin.from("show_mentions").insert(row);
  if (error) return { type: env.type, ok: false, detail: error.message };
  return { type: env.type, ok: true, detail: `mention of "${showName}"` };
}

async function handleSellerSnapshot(
  admin: Admin,
  env: EventEnvelope,
): Promise<EventResult> {
  const sellerId = str(env.payload.seller_id);
  if (!sellerId) return { type: env.type, ok: false, detail: "missing seller_id" };
  const observed = toIso(env.occurred_at, nowIso());

  const sellerRow: Record<string, unknown> = { seller_id: sellerId };
  for (const k of [
    "seller_name",
    "seller_location",
    "membership",
    "feedback_count",
    "seller_rating_score",
    "five_star_rating",
    "total_listings",
    "avg_price",
  ]) {
    if (k in env.payload) sellerRow[k] = env.payload[k];
  }
  const { error: upErr } = await admin
    .from("market_sellers")
    .upsert(sellerRow, { onConflict: "seller_id" });
  if (upErr) return { type: env.type, ok: false, detail: `sellers upsert: ${upErr.message}` };

  const { error } = await admin.from("seller_snapshots").insert({
    seller_id: sellerId,
    observed_at: observed,
    feedback_count: int(env.payload.feedback_count),
    seller_rating_score: num(env.payload.seller_rating_score),
    five_star_rating: num(env.payload.five_star_rating),
    total_listings: int(env.payload.total_listings),
    avg_price: num(env.payload.avg_price),
    membership: str(env.payload.membership),
    source: env.source ?? "extension",
  });
  if (error) return { type: env.type, ok: false, detail: error.message };
  return { type: env.type, ok: true, detail: `snapshot of ${sellerId}` };
}

async function handleCrossPlatform(
  admin: Admin,
  env: EventEnvelope,
): Promise<EventResult> {
  const platform = str(env.payload.platform);
  const externalId = str(env.payload.external_id);
  if (!platform || !externalId) {
    return { type: env.type, ok: false, detail: "missing platform/external_id" };
  }
  const observed = toIso(env.occurred_at, nowIso());

  const { data: existing } = await admin
    .from("cross_platform_listings")
    .select("id, first_seen_at")
    .eq("platform", platform)
    .eq("external_id", externalId)
    .maybeSingle();

  const row: Record<string, unknown> = {
    platform,
    external_id: externalId,
    title: str(env.payload.title),
    description: str(env.payload.description),
    price: num(env.payload.price),
    price_usd_equivalent: num(env.payload.price_usd_equivalent),
    currency: str(env.payload.currency),
    seller_name: str(env.payload.seller_name),
    seller_location: str(env.payload.seller_location),
    url: str(env.payload.url),
    traits_raw: str(env.payload.traits_raw),
    first_seen_at: (existing?.first_seen_at as string | undefined) ?? observed,
    last_seen_at: observed,
    payload: env.payload,
  };

  const { error } = await admin
    .from("cross_platform_listings")
    .upsert(row, { onConflict: "platform,external_id" });
  if (error) return { type: env.type, ok: false, detail: error.message };
  return { type: env.type, ok: true, detail: `${platform}/${externalId} upserted` };
}

async function handleAlertMatch(
  admin: Admin,
  env: EventEnvelope,
): Promise<EventResult> {
  const alertId = str(env.payload.alert_id);
  if (!alertId) return { type: env.type, ok: false, detail: "missing alert_id" };

  // Verify the alert exists. INGEST_API_KEY authenticates the extension but
  // does not bind it to a specific user, so a caller could otherwise forge
  // matches against arbitrary alert ids. Existence check at least guarantees
  // we only write matches for alerts the app knows about, and avoids a FK
  // violation on bad input.
  const { data: alertRow, error: alertErr } = await admin
    .from("alerts")
    .select("id")
    .eq("id", alertId)
    .maybeSingle();
  if (alertErr) return { type: env.type, ok: false, detail: alertErr.message };
  if (!alertRow) return { type: env.type, ok: false, detail: `alert ${alertId} not found` };

  const listingId = str(env.payload.listing_id);
  const crossId = str(env.payload.cross_platform_listing_id);
  if (!listingId && !crossId) {
    return { type: env.type, ok: false, detail: "one of listing_id or cross_platform_listing_id required" };
  }
  if (listingId) await ensureListingStub(admin, listingId);
  const { error } = await admin.from("alert_matches").insert({
    alert_id: alertId,
    listing_id: listingId,
    cross_platform_listing_id: crossId,
    matched_at: toIso(env.occurred_at, nowIso()),
    payload: env.payload,
  });
  if (error) return { type: env.type, ok: false, detail: error.message };
  return { type: env.type, ok: true, detail: `match for alert ${alertId}` };
}

// ----- dispatcher -----------------------------------------------------------

export async function handleEvent(
  admin: Admin,
  env: EventEnvelope,
): Promise<EventResult> {
  try {
    switch (env.type) {
      case "listingSeen":
      case "listingDetail":
        return await handleListingSeen(admin, env);
      case "searchResultBatch":
        return await handleSearchResultBatch(admin, env);
      case "priceDrop":
        return await handlePriceDrop(admin, env);
      case "soldInferred":
        return await handleSoldInferred(admin, env);
      case "auctionClose":
        return await handleAuctionClose(admin, env);
      case "showMention":
        return await handleShowMention(admin, env);
      case "sellerSnapshot":
        return await handleSellerSnapshot(admin, env);
      case "crossPlatform":
        return await handleCrossPlatform(admin, env);
      case "alertMatch":
        return await handleAlertMatch(admin, env);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { type: env.type, ok: false, detail: msg };
  }
}
