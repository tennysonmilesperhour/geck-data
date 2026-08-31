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
  - public.price_history    (one row per observation, keyed on
                             (listing_id, observed_at); duplicates are
                             dropped inside the batch and again by the
                             unique index in migration 0050)

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


def canonical_seller_id(
    seller_slug: Optional[str], seller_name: Optional[str]
) -> Optional[str]:
    """The seller_id a listing should carry.

    Prefer MorphMarket's real seller slug when the row has it — the detail
    scrape and the Eye in the Sky extension both capture it (e.g.
    'emikos_geckos', 'jackies_critter_collection'). Only fall back to
    slugifying the display name when no real slug is present. Keeping the real
    slug means one seller resolves to one id across the extension, the scraper
    and this canonical mirror, instead of splitting into e.g.
    'jackies_critter_collection' vs 'jackiescrittercollection'. Underscores and
    hyphens in a real slug are part of the id and are preserved; only casing is
    normalised.
    """
    slug = (seller_slug or "").strip().lower()
    if slug:
        return slug
    return slug_seller_id(seller_name)


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


# Property names MorphMarket exposes alongside the real morph tags. The
# scrapers concatenate the whole additionalProperty list, so these leak in as
# if they were traits ("Diet: Meal Replacement" was a top-10 "combo" before
# migration 0039 cleaned it out). Mirror of the regex in
# public._normalize_trait_csv(); keep the two in step.
NON_TRAIT_KEYS = (
    "diet", "proven breeder", "sex", "maturity", "weight", "birth date",
    "birthdate", "hatched", "origin", "pet only", "lineage", "shipping",
    "payment", "scientific name", "category",
)

def _is_non_trait(segment: str) -> bool:
    """True for 'Diet: Cricket, Meal Replacement' and the bare 'Diet' form."""
    head = segment.split(":", 1)[0].strip().lower()
    return head in NON_TRAIT_KEYS


def trait_tokens(raw: Any) -> list[str]:
    """Split a raw trait string into real morph tokens.

    The delimiters are not interchangeable. Pipes separate PROPERTIES and
    commas list values INSIDE one property:

        Diet: Cricket, Meal Replacement | Proven breeder: No | Harlequin, Dark

    So the parse is pipe-first: drop a non-trait property segment whole (its
    values go with it), then comma-split only what survives. Splitting on
    both at once orphans the diet values and they end up looking like morphs,
    which is what migration 0039 did and 0041 had to undo.

    De-duplicates case-insensitively while preserving order.
    """
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        # Already tokenized upstream (the API ingest passes trait names), so
        # each element is atomic; do not comma-split a real trait name.
        segments = [(str(t), False) for t in raw]
    else:
        text = str(raw).strip()
        if not text:
            return []
        segments = [(seg, True) for seg in text.split("|")]

    out: list[str] = []
    seen: set[str] = set()
    for segment, splittable in segments:
        segment = segment.strip()
        if not segment or _is_non_trait(segment):
            continue
        pieces = segment.split(",") if splittable else [segment]
        for piece in pieces:
            token = piece.strip()
            if not token:
                continue
            key = token.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(token)
    return out


# Multi-animal listings price a GROUP, so they cannot sit in a per-animal
# median or be compared against one to compute a discount. Production had
# "Group Of 5" at $100 total and a wholesale 5/10 lot at $50, which the
# landing page advertised as a 90% deal. Mirror of public._looks_like_group_lot
# (migration 0042); keep the two in step. Eager by design: a false positive
# costs one listing of comp breadth, a false negative distorts a median.
_GROUP_LOT_RES = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\b(lot|lots|pack|packs|wholesale|bundle|colony|pair|pairs|trio|trios|quad|group)\b",
        r"\b(x\s*[2-9]|[2-9]\s*x)\b",
        r"\b(two|three|four|five|six)\s+(pack|lot|group|of)\b",
        r"\bgroup\s+of\s+[0-9]+\b",
    )
)


def looks_like_group_lot(title: Optional[str]) -> bool:
    """True when the title describes more than one animal."""
    if not title:
        return False
    return any(rx.search(title) for rx in _GROUP_LOT_RES)


def cached_traits_string(
    trait_array: Optional[list[str]], traits_csv: Optional[str]
) -> Optional[str]:
    """Comma-delimited morph tokens for market_listings.cached_traits.

    Comma delimited because that is what the 0037 combo views tokenize on.
    Writing MorphMarket's pipes through verbatim (the pre-0039 behaviour)
    made the whole string read as one opaque token, so no combo was ever
    built from scraper rows.
    """
    tokens = trait_tokens(trait_array) or trait_tokens(traits_csv)
    return ", ".join(tokens) if tokens else None


def norm_traits_string(trait_array: Optional[list[str]], traits_csv: Optional[str]) -> Optional[str]:
    """Lowercase, space-joined trait token string used by the search UI."""
    tokens = trait_tokens(trait_array) or trait_tokens(traits_csv)
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

    payload = {
        "id": canonical_id(listing_id),
        "morphmarket_key": _safe_int(listing_id),
        "url": row.get("listing_url") or None,
        "title": row.get("name") or None,
        "description": row.get("description") or None,
        "price": price,
        "price_usd_equivalent": price if (row.get("currency") or "USD") == "USD" else None,
        "cached_traits": cached_traits_string(
            row.get("trait_array"), row.get("traits")
        ),
        "is_group_lot": looks_like_group_lot(row.get("name")),
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
        "seller_id": canonical_seller_id(
            row.get("seller_slug"), row.get("seller_name")
        ),
        "seller_name": row.get("seller_name") or None,
        "store_name": row.get("seller_name") or None,
        "min_shipping": min_ship,
        "max_shipping": max_ship,
        "source": "scraper",
        # first_seen_at is intentionally omitted. An upsert that sends it
        # overwrites the original discovery stamp on every recrawl.
        "last_seen_at": row.get("last_seen_at"),
        "imported_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    species = infer_species(row)
    if species:
        payload["species"] = species
    return payload


def infer_species(row: dict[str, Any]) -> Optional[str]:
    """Stamp crested when the source proves it. Never write 'unknown'."""
    raw = str(row.get("species") or "").strip().lower()
    if raw in ("crested", "crested-gecko", "crested gecko"):
        return "crested"
    blob = " ".join(
        str(row.get(k) or "")
        for k in ("scientific_name", "category", "name")
    ).lower()
    if "correlophus ciliatus" in blob or "crested gecko" in blob:
        return "crested"
    return None


def transform_seller(row: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Derive a minimal market_sellers row from one scraper listing.

    Only the fields the scraper actually has. The web app routes that read
    market_sellers handle NULL on enrichment fields (about_text, social
    links, breakdown JSON) — they fall back to defaults or skip the widget.

    Returns None if there's no seller_name to slug.
    """
    seller_id = canonical_seller_id(row.get("seller_slug"), row.get("seller_name"))
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
        self.price_drops_inserted = 0
        self.skipped_no_id = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "market_listings_upserted": self.listings_upserted,
            "market_listings_failed": self.listings_failed,
            "market_sellers_upserted": self.sellers_upserted,
            "market_sellers_failed": self.sellers_failed,
            "price_history_inserted": self.price_history_inserted,
            "price_history_failed": self.price_history_failed,
            "price_drops_inserted": self.price_drops_inserted,
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

    # 0. Snapshot old prices so we can detect price drops AFTER the upsert.
    # Without this, the Daily Log's "Price drops" card stays empty because
    # nothing else writes to public.price_drops since the extension stopped.
    old_prices: dict[str, float] = {}
    if listings_batch:
        try:
            ids = [p["id"] for p in listings_batch]
            for sub in _chunked(ids, 200):
                res = supabase.table("market_listings").select(
                    "id, price"
                ).in_("id", sub).execute()
                for row in (res.data or []):
                    if row.get("price") is not None:
                        old_prices[row["id"]] = float(row["price"])
        except APIError as exc:
            if logger:
                logger.warning(f"old-price snapshot failed: {exc}")

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

    # 3. price_history. Keyed on (listing_id, observed_at) since migration
    #    0050. Two things follow from that key and both matter here.
    #
    #    Duplicates inside one batch have to go first: two rows with the same
    #    key in a single ON CONFLICT statement is an error, not a merge, and
    #    it would fail the whole batch rather than the offending row. Keeping
    #    the last occurrence matches the loop above, which builds the payloads
    #    in row order.
    #
    #    The write is then an upsert that ignores conflicts rather than an
    #    insert. A scraper pass is a passive re-observation, so it must not
    #    overwrite an explicit price-change event already recorded at the same
    #    instant by the ingest API. Re-running a backfill is now a no-op here
    #    instead of a second copy of every observation.
    deduped_prices = {
        (p["listing_id"], p["observed_at"]): p for p in price_payloads
    }
    for batch in _chunked(list(deduped_prices.values()), PRICE_HISTORY_BATCH):
        try:
            supabase.table("price_history").upsert(
                batch,
                on_conflict="listing_id,observed_at",
                ignore_duplicates=True,
            ).execute()
            stats.price_history_inserted += len(batch)
        except APIError as exc:
            stats.price_history_failed += len(batch)
            if logger:
                logger.warning(
                    f"price_history upsert failed ({len(batch)} rows): {exc}"
                )

    # 4. price_drops — one row per listing whose price moved DOWN. Uses the
    #    pre-upsert snapshot so we don't compare against the post-upsert
    #    value. Threshold: require a >= 1% drop AND >= $1 absolute drop to
    #    cut noise from rounding.
    if old_prices:
        drops: list[dict[str, Any]] = []
        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        for p in listings_batch:
            new_price = p.get("price")
            if new_price is None:
                continue
            try:
                new_f = float(new_price)
            except (TypeError, ValueError):
                continue
            old_f = old_prices.get(p["id"])
            if old_f is None or old_f <= 0:
                continue
            if new_f >= old_f:
                continue
            abs_drop = old_f - new_f
            pct = (abs_drop / old_f) * 100.0
            if abs_drop < 1.0 or pct < 1.0:
                continue
            drops.append({
                "listing_id":  p["id"],
                "old_price":   round(old_f, 2),
                "new_price":   round(new_f, 2),
                "old_price_usd": round(old_f, 2) if (p.get("price_usd_equivalent") is not None) else None,
                "new_price_usd": round(new_f, 2) if (p.get("price_usd_equivalent") is not None) else None,
                "currency":    "USD",
                "pct_change":  round(-pct, 2),
                "observed_at": now_iso,
                "source":      "scraper",
            })
        for batch in _chunked(drops, PRICE_HISTORY_BATCH):
            try:
                supabase.table("price_drops").insert(batch).execute()
                stats.price_drops_inserted += len(batch)
            except APIError as exc:
                if logger:
                    logger.warning(
                        f"price_drops insert failed ({len(batch)} rows): {exc}"
                    )

    return stats
