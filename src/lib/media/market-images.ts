import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const IMAGE_QUERY_CHUNK = 80;
const SELLER_VISUAL_LIMIT = 16;

export type SellerVisual = {
  avatarUrl: string | null;
  recentListingImageUrl: string | null;
};

type SellerProfileRow = {
  seller_slug: string;
  avatar_url: string | null;
};

type ListingImageRow = {
  listing_id: string;
  primary_image_url: string | null;
};

type SellerListingImageRow = ListingImageRow & {
  seller_slug: string | null;
};

type SellerMarketListingRow = {
  id: string;
  seller_id: string | null;
};

/**
 * Keep user-facing media on the two hosts the ingest pipeline owns or
 * explicitly captures. This prevents a malformed database value from turning
 * a server-rendered image into an arbitrary remote request.
 */
export function safeMarketImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const isMarketplaceCdn = url.hostname === "d2bjn9a420fiq0.cloudfront.net";
    const isProjectStorage =
      url.hostname.endsWith(".supabase.co") &&
      url.pathname.startsWith("/storage/v1/object/public/");
    return isMarketplaceCdn || isProjectStorage ? url.toString() : null;
  } catch {
    return null;
  }
}

export function rawMarketplaceListingId(id: string): string {
  return id.startsWith("mm_") ? id.slice(3) : id;
}

/**
 * Resolve canonical listing photography for market-listing ids. The returned
 * map accepts both raw MorphMarket ids and the mm_-prefixed analytics ids.
 */
export async function getListingImageMap(
  supabase: SupabaseClient,
  listingIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const rawIds = [...new Set(listingIds.map(rawMarketplaceListingId).filter(Boolean))];
  const result = new Map<string, string>();

  for (let start = 0; start < rawIds.length; start += IMAGE_QUERY_CHUNK) {
    const chunk = rawIds.slice(start, start + IMAGE_QUERY_CHUNK);
    const { data } = await supabase
      .from("listings")
      .select("listing_id, primary_image_url")
      .in("listing_id", chunk)
      .not("primary_image_url", "is", null);

    for (const row of (data ?? []) as ListingImageRow[]) {
      const imageUrl = safeMarketImageUrl(row.primary_image_url);
      if (!imageUrl) continue;
      result.set(row.listing_id, imageUrl);
      result.set(`mm_${row.listing_id}`, imageUrl);
    }
  }

  return result;
}

/**
 * Seller avatars come from the marketplace store's og:image. A recent stock
 * photo is kept separate: it is useful visual context, but it must never be
 * mistaken for the seller's identity image.
 */
export async function getSellerVisualMap(
  supabase: SupabaseClient,
  sellerIds: ReadonlyArray<string>,
  options: { includeRecentListing?: boolean } = {},
): Promise<Map<string, SellerVisual>> {
  const ids = [...new Set(sellerIds.filter(Boolean))];
  const wanted = new Set(ids);
  const result = new Map<string, SellerVisual>();

  if (ids.length === 0) return result;

  const profileQuery = supabase
    .from("sellers")
    .select("seller_slug, avatar_url")
    .limit(1000);
  const { data: profileData } =
    ids.length <= IMAGE_QUERY_CHUNK
      ? await profileQuery.in("seller_slug", ids)
      : await profileQuery;

  for (const row of (profileData ?? []) as SellerProfileRow[]) {
    if (!wanted.has(row.seller_slug)) continue;
    result.set(row.seller_slug, {
      avatarUrl: safeMarketImageUrl(row.avatar_url),
      recentListingImageUrl: null,
    });
  }

  for (const id of ids) {
    if (!result.has(id)) {
      result.set(id, { avatarUrl: null, recentListingImageUrl: null });
    }
  }

  if (options.includeRecentListing) {
    const visualIds = ids.slice(0, SELLER_VISUAL_LIMIT);
    const { data: recentRows } = await supabase
      .from("listings")
      .select("seller_slug, listing_id, primary_image_url")
      .in("seller_slug", visualIds)
      .eq("is_active", true)
      .not("primary_image_url", "is", null)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(1000);

    for (const row of (recentRows ?? []) as SellerListingImageRow[]) {
      if (!row.seller_slug) continue;
      const current = result.get(row.seller_slug) ?? {
        avatarUrl: null,
        recentListingImageUrl: null,
      };
      if (current.recentListingImageUrl) continue;
      result.set(row.seller_slug, {
        ...current,
        recentListingImageUrl: safeMarketImageUrl(row.primary_image_url),
      });
    }

    // Older market rows often predate listings.seller_slug. For those sellers,
    // use the canonical id bridge already used by seller detail pages: take a
    // bounded set of their newest market listing ids, then resolve the exact
    // stored photos. The image remains labelled as stock, never as an avatar.
    const missingIds = visualIds.filter(
      (sellerId) => !result.get(sellerId)?.recentListingImageUrl,
    );
    if (missingIds.length > 0) {
      const { data: marketRows } = await supabase
        .from("market_listings")
        .select("id, seller_id")
        .in("seller_id", missingIds)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      const candidates = new Map<string, string[]>();
      for (const row of (marketRows ?? []) as SellerMarketListingRow[]) {
        if (!row.seller_id) continue;
        const idsForSeller = candidates.get(row.seller_id) ?? [];
        if (idsForSeller.length >= 12) continue;
        idsForSeller.push(row.id);
        candidates.set(row.seller_id, idsForSeller);
      }
      const fallbackImages = await getListingImageMap(
        supabase,
        [...candidates.values()].flat(),
      );
      for (const sellerId of missingIds) {
        const imageUrl = (candidates.get(sellerId) ?? [])
          .map((listingId) => fallbackImages.get(listingId))
          .find(Boolean);
        if (!imageUrl) continue;
        const current = result.get(sellerId) ?? {
          avatarUrl: null,
          recentListingImageUrl: null,
        };
        result.set(sellerId, { ...current, recentListingImageUrl: imageUrl });
      }
    }
  }

  return result;
}
