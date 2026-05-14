"""
Translate scraper-shape `listings` rows into the canonical `market_listings`
schema and upsert them, along with `market_sellers` and `price_history`.

Why this exists: the public web app (every route under /, /trends, /sellers,
/data/market.json, etc.) and the Geck Inspect companion app read from
`market_listings` / `market_sellers` / `price_history`. The Decodo scraper
historically wrote only to `listings` / `listings_history`, which meant the
5,800+ historical rows were invisible to paying clients.

This module is the single bridge. Call upsert_canonical_from_listings() with
a batch of dicts shaped like rows from public.listings (the same dicts the
scraper produces) and it writes:

  - public.market_listings  (one upsert per listing, PK = id)
  - public.market_sellers   (one upsert per unique seller in the batch)
  - public.price_history    (one insert per observation; idempotent within
                             a run via (listing_id, observed_at) dedupe)

ID convention: market_listings.id is stored as "mm_<numeric>" to match the
Eye in the Sky extension's convention. Legacy bare-numeric rows in
market_listings (about 21 of them, from the original 2026-04 Python upload)
remain untouched; a separate one-shot dedupe script can merge them later.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any, Iterable, Optional

from postgrest.exceptions import APIError


MARKET_LISTING_BATCH = 200
MARKET_SELLER_BATCH = 100
PRICE_HISTORY_BATCH = 500


# ---------------------------------------------------------------------------
# Pure transformation helpers (no DB access, easy to unit test)
# ---------------------------------------------------------------------------


def canonical_id(listing_id: str) -> str:
    """Normalize a bare-numeric scraper id to the mm_-prefixed extension id."""
    listing_id = (listing_id or "").strip()
    if not listing_id:
        return ""
    if listing_id.startswith("mm_"):
        return listing_id
    return f"mm_{listing_id}"


def slug_seller_id(seller_name: Optional[str]) -> Optional[str]:
    """Derive a stable seller_id slug from a free-text seller name.

    The extension uses MorphMarket's real seller slug (e.g. 'jaskiexotics').
    The scraper only sees the display name, so we lowercase + strip non-alnum.
    Collisions are tolerable: market_sellers PK is seller_id and the same
    name maps to the same slug deterministically.
    """
    if not seller_name:
        return None
    slug = re.sub(r"[^a-z0-9]+", "", seller_name.lower()).strip()
    return slug or None


def parse_birth_date(raw: Optional[str]) -> tuple[Optional[int], Optional[int], Optional[int]]:
    """Parse strings like '7th October 2025' or '2025-10-07' into (y, m, d).

    Returns (None, None, None) on failure rather than raising — birth_date is
    cosmetic and the listing should not be dropped over it.
    """
    if not raw:
        return (None, None, None)
    text = raw.strip()
    if not text:
        return (None, None, None)
    # Try ISO first
    try:
        d = dt.date.fromisoformat(text[:10])
        return (d.year, d.month, d.day)
    except ValueError:
        pass
    # "7th October 2025" / "1st March 2024"
    months = {
        "january": 1, "february": 2, "march": 3, "april": 4,
        "may": 5, "june": 6, "july": 7, "august": 8,
        "september": 9, "october": 10, "november": 11, "december": 12,
    }
    m = re.match(
        r"(?P<d>\d{1,2})(?:st|nd|rd|th)?\s+(?P<m>[A-Za-z]+)\s+(?P<y>\d{4})",
        text,
    )
    if m:
        month = months.get(m.group("m").lower())
        if month:
            try:
                return (int(m.group("y")), month, int(m.group("d")))
            except ValueError:
                return (None, None, None)
    return (None, None, None)


def is_sold_from_availability(availability: Optional[str]) -> bool:
    """Map schema.org availability strings to a sold flag."""
    if not availability:
        return False
    text = availability.lower()
    return any(m in text for m in ("soldout", "outofstock", "discontinued"))


def normalize_sex(sex: Optional[str]) -> Optional[str]:
    """market_listings.sex is lowercase 'male'/'female'/'unknown'."""
    if not sex:
        return None
    lowered = sex.strip().lower()
    if lowered in ("male", "female", "unknown"):
        return lowered
    return "unknown"


def norm_traits_string(trait_array: Optional[list[str]], traits_csv: Optional[str]) -> Optional[str]:
    """Lowercase, space-joined trait token string used by the search UI."""
    tokens: list[str] = []
    if trait_array:
        tokens = [str(t).strip() for t in trait_array if t and str(t).strip()]
    elif traits_csv:
        tokens = [t.strip() for t in traits_csv.split(",") if t.strip()]
    if not tokens:
        return None
    return " ".join(t.lower() for t in tokens)


def parse_shipping_rate(shipping_rate: Any, shipping_label: Optional[str]) -> tuple[Optional[int], Optional[int]]:
    """Best-effort min/max shipping ints from the scraper's shipping fields.

    The scraper records shipping_label like 'Free Shipping' or '$50 flat' and
    shipping_rate as a float. market_listings has min_shipping/max_shipping
    integers. Be permissive — return (None, None) on anything weird.
    """
    label = (shipping_label or "").lower()
    if "free" in label:
        return (0, 0)
    if shipping_rate is None:
        return (None, None)
    try:
        rate = int(round(float(shipping_rate)))
    except (TypeError, ValueError):
        return (None, None)
    return (rate, rate)


def transform_listing(row: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Translate one public.listings row into a market_listings upsert payload.

    Returns None if the row has no listing_id (we never upsert a blank PK).
    """
    listing_id = (row.get("listing_id") or "").strip()
    if not listing_id:
        return None

    birth_y, birth_m, birth_d = parse_birth_date(row.get("birth_date"))
    min_ship, max_ship = parse_shipping_rate(
        row.get("shipping_rate"), row.get("shipping_label")
    )
    price_raw = row.get("price")
    try:
        price = int(round(float(price_raw))) if price_raw is not None else None
    except (TypeError, ValueError):
        price = None

    return {
        "id": canonical_id(listing_id),
        "morphmarket_key": _safe_int(listing_id),
        "url": row.get("listing_url") or None,
        "title": row.get("name") or None,
        "description": row.get("description") or None,
        "price": price,
        "price_usd_equivalent": price if (row.get("currency") or "USD") == "USD" else None,
        "cached_traits": row.get("traits") or None,
        "norm_traits": norm_traits_string(
            row.get("trait_array"), row.get("traits")
        ),
        "sex": normalize_sex(row.get("sex")),
        "maturity": row.get("maturity") or None,
        "weight": row.get("weight") or None,
        "birth_year": birth_y,
        "birth_month": birth_m,
        "birth_day": birth_d,
        "item_origin": _normalize_origin(row.get("origin")),
        "is_sold": is_sold_from_availability(row.get("availability"))
            or (row.get("is_active") is False),
        "current_status": (
            "sold"
            if is_sold_from_availability(row.get("availability"))
                or (row.get("is_active") is False)
            else "live"
        ),
        "is_auction": False,
        "is_on_hold": False,
        "is_renewed": False,
        "price_flagged": False,
        "detail_collected": True,
        "has_dams": False,
        "has_sires": False,
        "seller_id": slug_seller_id(row.get("seller_name")),
        "seller_name": row.get("seller_name") or None,
        "store_name": row.get("seller_name") or None,
        "min_shipping": min_ship,
        "max_shipping": max_ship,
        "source": "scraper",
        "first_seen_at": row.get("first_seen_at"),
        "last_seen_at": row.get("last_seen_at"),
        "imported_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def transform_seller(row: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Derive a minimal market_sellers row from one scraper listing.

    Only the fields the scraper actually has. The web app routes that read
    market_sellers handle NULL on enrichment fields (about_text, social
    links, breakdown JSON) — they fall back to defaults or skip the widget.

    Returns None if there's no seller_name to slug.
    """
    seller_id = slug_seller_id(row.get("seller_name"))
    if not seller_id:
        return None
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    return {
        "seller_id": seller_id,
        "seller_name": row.get("seller_name"),
        "updated_at": now_iso,
    }


def transform_price_observation(row: dict[str, Any]) -> Optional[dict[str, Any]]:
    """One price_history row per scraper observation."""
    listing_id = (row.get("listing_id") or "").strip()
    price = row.get("price")
    if not listing_id or price is None:
        return None
    try:
        price_int = int(round(float(price)))
    except (TypeError, ValueError):
        return None
    return {
        # FK references market_listings.id. The canonical helper writes the
        # listing as id="mm_<numeric>", so price_history must use the same
        # prefixed form. Legacy price_history rows from the 2026-04 bulk
        # upload use bare numeric and reference the ~21 legacy bare-id
        # market_listings rows; both conventions coexist.
        "listing_id": canonical_id(listing_id),
        "observed_at": row.get("first_seen_at") or row.get("last_seen_at")
            or dt.datetime.now(dt.timezone.utc).isoformat(),
        "price": price_int,
        "currency": row.get("currency") or "USD",
        "price_usd_equivalent": price_int if (row.get("currency") or "USD") == "USD" else None,
        "source": "scraper",
    }


def _safe_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_origin(raw: Optional[str]) -> Optional[str]:
    """Map free-text origin to market_listings.item_origin enum-ish values."""
    if not raw:
        return None
    text = raw.strip().lower()
    if "self" in text or "captive" in text or "cb" in text:
        return "captive_bred"
    if "import" in text or "wild" in text:
        return "wild_caught"
    if "rescue" in text:
        return "rescue"
    return None


def _chunked(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


# ---------------------------------------------------------------------------
# DB-touching upsert
# ---------------------------------------------------------------------------


class CanonicalWriteStats:
    """Counts what landed where, for run-summary logging."""

    def __init__(self) -> None:
        self.listings_upserted = 0
        self.listings_failed = 0
        self.sellers_upserted = 0
        self.sellers_failed = 0
        self.price_history_inserted = 0
        self.price_history_failed = 0
        self.skipped_no_id = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "market_listings_upserted": self.listings_upserted,
            "market_listings_failed": self.listings_failed,
            "market_sellers_upserted": self.sellers_upserted,
            "market_sellers_failed": self.sellers_failed,
            "price_history_inserted": self.price_history_inserted,
            "price_history_failed": self.price_history_failed,
            "skipped_no_id": self.skipped_no_id,
        }


def upsert_canonical_from_listings(
    supabase,
    rows: list[dict[str, Any]],
    *,
    write_price_history: bool = True,
    logger=None,
) -> CanonicalWriteStats:
    """Translate a batch of public.listings rows and write canonical tables.

    `rows` are dicts already shaped like public.listings columns (the same
    shape the scraper and CSV migration construct before they upsert).

    `write_price_history=False` skips the price_history insert — useful for
    re-running a backfill where we don't want to re-observe prices we've
    already observed at the same first_seen_at.

    Logger is any object with `.info(str)` / `.warning(str)`; defaults to
    silent.
    """
    stats = CanonicalWriteStats()

    listings_payloads: list[dict[str, Any]] = []
    sellers_by_id: dict[str, dict[str, Any]] = {}
    price_payloads: list[dict[str, Any]] = []

    for raw in rows:
        listing_payload = transform_listing(raw)
        if not listing_payload:
            stats.skipped_no_id += 1
            continue
        listings_payloads.append(listing_payload)

        seller_payload = transform_seller(raw)
        if seller_payload:
            sellers_by_id[seller_payload["seller_id"]] = seller_payload

        if write_price_history:
            obs = transform_price_observation(raw)
            if obs:
                price_payloads.append(obs)

    # Deduplicate listings by id within the batch — PostgreSQL refuses to
    # upsert the same row twice in one ON CONFLICT statement.
    deduped_listings = {p["id"]: p for p in listings_payloads}
    listings_batch = list(deduped_listings.values())

    # 1. market_sellers first (FK target of market_listings.seller_id, if any)
    for batch in _chunked(list(sellers_by_id.values()), MARKET_SELLER_BATCH):
        try:
            supabase.table("market_sellers").upsert(
                batch, on_conflict="seller_id"
            ).execute()
            stats.sellers_upserted += len(batch)
        except APIError as exc:
            stats.sellers_failed += len(batch)
            if logger:
                logger.warning(
                    f"market_sellers upsert failed ({len(batch)} rows): {exc}"
                )

    # 2. market_listings
    for batch in _chunked(listings_batch, MARKET_LISTING_BATCH):
        try:
            supabase.table("market_listings").upsert(
                batch, on_conflict="id"
            ).execute()
            stats.listings_upserted += len(batch)
        except APIError as exc:
            stats.listings_failed += len(batch)
            if logger:
                logger.warning(
                    f"market_listings upsert failed ({len(batch)} rows): {exc}"
                )

    # 3. price_history (insert-only; the table has no natural unique key,
    #    so duplicates are merely noisy, not fatal).
    for batch in _chunked(price_payloads, PRICE_HISTORY_BATCH):
        try:
            supabase.table("price_history").insert(batch).execute()
            stats.price_history_inserted += len(batch)
        except APIError as exc:
            stats.price_history_failed += len(batch)
            if logger:
                logger.warning(
                    f"price_history insert failed ({len(batch)} rows): {exc}"
                )

    return stats
