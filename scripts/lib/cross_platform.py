"""Pure helpers for non-MorphMarket (cross-platform) ingest.

Crested-only filters, group-lot flags, Feedle KRW-to-USD conversion, and
shop merch skips live here so the scrape script stays I/O. Nothing in this
module writes to MorphMarket tables.
"""
from __future__ import annotations

import math
import re
from typing import Any, Optional

# Mirror of scripts/lib/canonical.py looks_like_group_lot. Copied so this
# module can be imported without pulling postgrest (canonical.py imports it
# at module load). Keep the patterns in step.

CRESTED_SPECIES = "crested"

# Feedle speciesList code for crested gecko, confirmed live 2026-08-30.
FEEDLE_CRESTED_CODE = "0001"

OTHER_SPECIES_RE = re.compile(
    r"gargoyle|leopard gecko|leachie|leachianus|chahoua|fat[\s-]?tail|"
    r"bearded dragon|skink|chameleon|correlophus sarasinorum|"
    r"rhacodactylus|eublepharis|mniarogekko",
    re.IGNORECASE,
)

CRESTED_RE = re.compile(
    r"crested gecko|correlophus ciliatus",
    re.IGNORECASE,
)

MERCH_RE = re.compile(
    r"\b(gift card|gift cards|diet|vital meal|pangea|supplement|"
    r"caging|enclosure|terrarium|sample pack|apparel|t-shirt|tshirt|"
    r"tank top|hoodie|crewneck|sticker|decal)\b",
    re.IGNORECASE,
)

ALTITUDE_BLOCKED_CATEGORY_RE = re.compile(
    r"\b(add[\s-]?on(?: item)?|other geckos?|supplies?|merch(?:andise)?)\b",
    re.IGNORECASE,
)

# Extra group-lot phrases used by brand shops, on top of the MorphMarket
# looks_like_group_lot patterns copied above.
SHOP_GROUP_RE = re.compile(
    r"mystery\s*box|mystery\s*group|group\s*baby|wholesale|\bspecial\b",
    re.IGNORECASE,
)

# Feedle pack language. pair / trio / quad / group are morph tokens there
# (Quad stripe, Pair, Trio) so they are not matched unless a numeric or
# pack context is present (group of 3, 5-pack, x2).
FEEDLE_PACK_RE = re.compile(
    r"mystery\s*box|mystery\s*group|wholesale|"
    r"\b(lots?|packs?|bundle|colony)\b|"
    r"\blot\s+of\b|"
    r"\bgroup\s+of\s+[0-9]+\b|"
    r"\b(x\s*[2-9]|[2-9]\s*x)\b|"
    r"\b[0-9]+\s*[-]?\s*packs?\b|"
    r"\b(two|three|four|five|six)\s+(pack|lot|group|of)\b",
    re.IGNORECASE,
)

EXCLUDE_COMBO_RE = re.compile(
    r"gift card|hand-picked hatchling|hand picked hatchling|"
    r"generic hatchling",
    re.IGNORECASE,
)

EXCERPT_FIELD_RE = re.compile(
    r"(morph|weight|sex|lineage)\s*:\s*([^<]+)",
    re.IGNORECASE,
)


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
    if not title:
        return False
    return any(rx.search(title) for rx in _GROUP_LOT_RES)


def is_crested_text(*parts: Any) -> bool:
    blob = " ".join(str(p) for p in parts if p)
    if not blob.strip():
        return False
    if OTHER_SPECIES_RE.search(blob) and not CRESTED_RE.search(blob):
        return False
    return bool(CRESTED_RE.search(blob)) or (
        "crested" in blob.lower() and not OTHER_SPECIES_RE.search(blob)
    )


def is_merch_text(*parts: Any) -> bool:
    blob = " ".join(str(p) for p in parts if p)
    return bool(blob and MERCH_RE.search(blob))


def is_group_lot_text(*parts: Any) -> bool:
    blob = " ".join(str(p) for p in parts if p)
    if not blob.strip():
        return False
    if looks_like_group_lot(blob):
        return True
    return bool(SHOP_GROUP_RE.search(blob))


def is_feedle_group_lot(
    *,
    title: Any = None,
    size: Any = None,
    sale: Any = None,
    traits: Any = None,
) -> bool:
    """Pack flag for Feedle listings.

    Trait strings are ignored. Quad, Pair, Trio, and Group are morph
    tokens on Feedle, not multi-animal packs. Only title / size / sale
    fields are scanned, and only for pack language (mystery box,
    wholesale, group of N, x2, colony, bundle, lot of).
    """
    del traits
    blob = " ".join(str(p) for p in (title, size, sale) if p)
    if not blob.strip():
        return False
    return bool(FEEDLE_PACK_RE.search(blob))


def exclude_from_combo_arb(*parts: Any) -> bool:
    blob = " ".join(str(p) for p in parts if p)
    if not blob.strip():
        return False
    if is_group_lot_text(blob):
        return True
    return bool(EXCLUDE_COMBO_RE.search(blob))


def feedle_air_usd(
    krw_price: Optional[float],
    usd_to_krw_rate: Optional[float],
    version: Any,
) -> Optional[int]:
    """Reproduce Feedle Air's displayed USD ask.

    Confirmed in their public JS as getGlobalPriceWithVersion:
      v2: ceil(0.9 * krw / rate * 1.15)
      v1: ceil(krw / rate * 1.15)
    A $0 / missing KRW ask is not a free animal. Return None.
    """
    if krw_price is None or usd_to_krw_rate is None:
        return None
    try:
        krw = float(krw_price)
        rate = float(usd_to_krw_rate)
    except (TypeError, ValueError):
        return None
    if krw <= 0 or rate <= 0:
        return None
    ver = 2 if str(version) in ("2", "2.0") else 1
    if ver == 2:
        usd = math.ceil(0.9 * krw / rate * 1.15)
    else:
        usd = math.ceil(krw / rate * 1.15)
    return int(usd) if usd > 0 else None


def krw_to_usd(krw_price: Optional[float], usd_to_krw_rate: Optional[float]) -> Optional[float]:
    """Straight FX, no Feedle import markup. None if either side is missing."""
    if krw_price is None or usd_to_krw_rate is None:
        return None
    try:
        krw = float(krw_price)
        rate = float(usd_to_krw_rate)
    except (TypeError, ValueError):
        return None
    if krw <= 0 or rate <= 0:
        return None
    usd = krw / rate
    return round(usd, 2) if usd > 0 else None


def parse_excerpt_fields(excerpt_html: Optional[str]) -> dict[str, str]:
    """Pull Morph / Weight / Sex / Lineage labels out of Squarespace excerpt HTML."""
    if not excerpt_html:
        return {}
    out: dict[str, str] = {}
    for key, raw in EXCERPT_FIELD_RE.findall(excerpt_html):
        value = re.sub(r"\s+", " ", raw).strip(" :-")
        if value:
            out[key.lower()] = value
    return out


def squarespace_category_labels(payload: dict[str, Any]) -> dict[str, str]:
    """Map Squarespace category IDs to searchable labels and paths."""
    labels: dict[str, str] = {}
    nested = payload.get("nestedCategories")
    if not isinstance(nested, dict):
        return labels

    def visit(node: Any) -> None:
        if not isinstance(node, dict):
            return
        category_id = str(node.get("id") or "").strip()
        parts = [
            str(node.get(key) or "").strip()
            for key in ("displayName", "fullSlug", "fullUrl")
        ]
        if category_id:
            labels[category_id] = " ".join(part for part in parts if part)
        children = node.get("children")
        if isinstance(children, list):
            for child in children:
                visit(child)

    visit(nested.get("all"))
    categories = nested.get("categories")
    if isinstance(categories, list):
        for category in categories:
            visit(category)
    return labels


def altitude_item_is_crested(
    item: dict[str, Any],
    category_labels: Optional[dict[str, str]] = None,
) -> bool:
    """Return true only for a physical Altitude crested gecko offer."""
    if str(item.get("productType") or "") != "1":
        return False

    title = str(item.get("title") or "")
    excerpt = str(item.get("excerpt") or "")
    body = str(item.get("body") or "")
    raw_category_ids = item.get("categoryIds")
    category_ids = raw_category_ids if isinstance(raw_category_ids, list) else []
    labels = category_labels or {}
    category_text = " ".join(
        labels.get(str(category_id), "") for category_id in category_ids
    )

    # Product copy can mention diet or supplies. Classify merchandise from
    # the product heading and Squarespace categories, not the full body.
    if is_merch_text(title, excerpt, category_text):
        return False
    if ALTITUDE_BLOCKED_CATEGORY_RE.search(category_text):
        return False

    classification_text = " ".join((title, excerpt, category_text))
    if OTHER_SPECIES_RE.search(classification_text):
        return False
    if is_crested_text(classification_text):
        return True

    # Altitude's individual animal titles are SKU codes. Their structured
    # Morph, Weight, and Sex excerpt fields are the fallback animal signal.
    fields = parse_excerpt_fields(excerpt)
    return bool(fields.get("morph") and fields.get("weight") and fields.get("sex"))


def squarespace_price_usd(item: dict[str, Any]) -> Optional[float]:
    """Squarespace store prices are integer cents on variants[0].price."""
    variants = item.get("variants") or []
    variant = variants[0] if variants and isinstance(variants[0], dict) else {}
    money = variant.get("priceMoney") if isinstance(variant, dict) else None
    if isinstance(money, dict) and money.get("value") not in (None, ""):
        try:
            value = float(money["value"])
            return value if value > 0 else None
        except (TypeError, ValueError):
            pass
    cents = variant.get("price") if isinstance(variant, dict) else None
    if cents is None:
        cents = item.get("priceCents")
    try:
        n = float(cents)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    # Live check 2026-08-30: 329900 cents -> $3299.00 on 24-IM-XP-9-30.
    if n >= 1000:
        return n / 100.0
    return n


def squarespace_qty(item: dict[str, Any]) -> Optional[int]:
    variants = item.get("variants") or []
    variant = variants[0] if variants and isinstance(variants[0], dict) else {}
    qty = variant.get("qtyInStock") if isinstance(variant, dict) else None
    if qty is None:
        qty = item.get("qtyInStock")
    try:
        return int(qty) if qty is not None else None
    except (TypeError, ValueError):
        return None


def shopify_price_usd(product: dict[str, Any]) -> Optional[float]:
    variants = product.get("variants") or []
    for variant in variants:
        if not isinstance(variant, dict):
            continue
        raw = variant.get("price")
        try:
            n = float(raw)
        except (TypeError, ValueError):
            continue
        if n > 0:
            return n
    return None


def shopify_available(product: dict[str, Any]) -> bool:
    variants = product.get("variants") or []
    return any(
        isinstance(v, dict) and v.get("available") is True for v in variants
    )


def traits_csv(parts: list[Any]) -> Optional[str]:
    tokens: list[str] = []
    seen: set[str] = set()
    for part in parts:
        if part is None:
            continue
        if isinstance(part, (list, tuple)):
            chunks = [str(x) for x in part if x]
        else:
            text = str(part).strip()
            if not text:
                continue
            chunks = re.split(r"[,;/|]+", text)
        for chunk in chunks:
            token = re.sub(r"\s+", " ", chunk).strip()
            key = token.lower()
            if token and key not in seen:
                seen.add(key)
                tokens.append(token)
    return ", ".join(tokens) if tokens else None


def coerce_int(value: Any) -> Optional[int]:
    if value is None or value is False:
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n
