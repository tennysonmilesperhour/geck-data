"""Pure helpers for non-MorphMarket (cross-platform) ingest.

Crested-only filters, group-lot flags, Feedle KRW-to-USD conversion, and
shop merch skips live here so the scrape script stays I/O. Nothing in this
module writes to MorphMarket tables.
"""
from __future__ import annotations

import math
import json
import re
from html.parser import HTMLParser
from typing import Any, Optional
from urllib.parse import urljoin

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


class _SquarespaceProductContextParser(HTMLParser):
    """Read Squarespace's public product-list payload from normal HTML."""

    def __init__(self) -> None:
        super().__init__()
        self.context: Optional[dict[str, Any]] = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag != "div" or self.context is not None:
            return
        values = dict(attrs)
        classes = (values.get("class") or "").split()
        raw = values.get("data-context")
        if "product-list" not in classes or not raw:
            return
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return
        if isinstance(parsed, dict) and isinstance(parsed.get("items"), list):
            self.context = parsed


def squarespace_product_payload(html_text: str) -> dict[str, Any]:
    """Convert a Squarespace product-list page into the legacy payload shape.

    Altitude served this embed through November 4, 2026. The live shop no
    longer does. altitude_catalog_items reads the current page and falls
    back to this helper when the old markup is still present.
    """
    parser = _SquarespaceProductContextParser()
    parser.feed(html_text)
    if parser.context is None:
        raise ValueError("Squarespace product-list data-context was not found")

    context = parser.context
    normalized: list[dict[str, Any]] = []
    for raw in context.get("items") or []:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        item["excerpt"] = item.get("excerpt") or item.get("description") or ""
        main_image = item.get("mainImage")
        if isinstance(main_image, dict) and main_image.get("assetUrl"):
            item["assetUrl"] = main_image["assetUrl"]
        elif isinstance(item.get("images"), list) and item["images"]:
            first = item["images"][0]
            if isinstance(first, dict):
                item["assetUrl"] = first.get("assetUrl")
        normalized.append(item)

    return {
        "items": normalized,
        "nestedCategories": context.get("nestedCategoryContext") or {},
    }


# Public catalog origin. /shop 308s here as of November 2026.
ALTITUDE_ORIGIN = "https://www.altitudeexotics.com"

# Next.js flight pushes, same shape Feedle uses. The second element is a
# JSON string, so json.loads restores the embedded catalog text.
_NEXT_F_PUSH_RE = re.compile(
    r'self\.__next_f\.push\(\[(\d+),("(?:\\.|[^"\\])*")\]\)'
)


def _flight_text(value: Any) -> Optional[str]:
    """Decode one React flight string.

    Undefined is the sentinel ``$undefined``. A real string that starts
    with ``$`` is stored with that dollar doubled, so ``$$1359`` is the
    price text ``$1359`` and ``$$79 Hand-Picked Hatchling`` keeps its
    leading dollar. Other values are not scraped text.
    """
    if not isinstance(value, str):
        return None
    if value == "$undefined":
        return None
    if value.startswith("$$"):
        value = value[1:]
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def _altitude_price_usd(value: Any) -> Optional[float]:
    """Parse an Altitude display price. Missing or non-positive stays None."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if number > 0 else None
    text = _flight_text(value)
    if not text:
        return None
    cleaned = text.replace("$", "").replace(",", "").strip()
    if not cleaned:
        return None
    try:
        number = float(cleaned)
    except ValueError:
        return None
    return number if number > 0 else None


def _altitude_image_url(value: Any) -> Optional[str]:
    text = _flight_text(value)
    if not text or text.startswith("//"):
        return None
    if text.startswith("https://") or text.startswith("http://"):
        return text
    if text.startswith("/"):
        return urljoin(ALTITUDE_ORIGIN + "/", text)
    return None


def _next_flight_text(html_text: str) -> str:
    parts: list[str] = []
    for raw in _NEXT_F_PUSH_RE.findall(html_text):
        try:
            decoded = json.loads(raw[1])
        except json.JSONDecodeError:
            continue
        if isinstance(decoded, str):
            parts.append(decoded)
    return "".join(parts)


def _json_array_at(blob: str, bracket: int) -> Optional[list[Any]]:
    depth = 0
    in_str = False
    escaped = False
    for index in range(bracket, len(blob)):
        char = blob[index]
        if in_str:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_str = False
            continue
        if char == '"':
            in_str = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                try:
                    parsed = json.loads(blob[bracket : index + 1])
                except json.JSONDecodeError:
                    return None
                return parsed if isinstance(parsed, list) else None
    return None


def _geckos_array(blob: str) -> Optional[list[Any]]:
    """Return the first JSON array under a "geckos" key, or None."""
    if not blob:
        return None
    marker = '"geckos":'
    start = 0
    while True:
        found = blob.find(marker, start)
        if found < 0:
            return None
        bracket = blob.find("[", found + len(marker))
        if bracket < 0:
            return None
        between = blob[found + len(marker) : bracket]
        if between.strip():
            start = found + len(marker)
            continue
        parsed = _json_array_at(blob, bracket)
        if parsed is not None:
            return parsed
        start = found + len(marker)


def _next_flight_geckos(html_text: str) -> Optional[list[Any]]:
    flight = _next_flight_text(html_text)
    found = _geckos_array(flight)
    if found is not None:
        return found
    if flight:
        return None
    return _geckos_array(html_text)


def _optional_observed_int(value: Any) -> Optional[int]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, str):
        text = _flight_text(value)
        if text is None:
            return None
        value = text
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _items_from_squarespace(payload: dict[str, Any]) -> list[dict[str, Any]]:
    labels = squarespace_category_labels(payload)
    items: list[dict[str, Any]] = []
    for raw in payload.get("items") or []:
        if not isinstance(raw, dict):
            continue
        fields = parse_excerpt_fields(str(raw.get("excerpt") or ""))
        category_ids = raw.get("categoryIds")
        if not isinstance(category_ids, list):
            category_ids = []
        category_text = " ".join(
            labels.get(str(category_id), "") for category_id in category_ids
        )
        image = raw.get("assetUrl")
        if not (isinstance(image, str) and image.startswith(("http://", "https://"))):
            image = None
        qty = squarespace_qty(raw)
        if qty == 0:
            sold: Optional[bool] = True
        elif qty is not None:
            sold = False
        else:
            sold = None
        items.append(
            {
                "external_id": str(raw.get("id") or "").strip(),
                "title": str(raw.get("title") or "").strip(),
                "morph": fields.get("morph"),
                "sex": fields.get("sex"),
                "weight": fields.get("weight"),
                "lineage": fields.get("lineage"),
                "sire": None,
                "dam": None,
                "excerpt": str(raw.get("excerpt") or ""),
                "body": str(raw.get("body") or ""),
                "price": squarespace_price_usd(raw),
                "qty": qty,
                "sold": sold,
                "image": image,
                "path": str(raw.get("fullUrl") or "").strip(),
                "species_text": "",
                "category_text": category_text,
                "product_type": raw.get("productType"),
                "category_ids": category_ids,
                "category_labels": [
                    labels.get(str(category_id), "")
                    for category_id in category_ids
                    if labels.get(str(category_id))
                ],
                "status": None,
                "certified": None,
                "shopify_handle": None,
                "variant_id": None,
                "traits": [fields["morph"]] if fields.get("morph") else [],
                "squarespace_item": raw,
                "category_label_map": labels,
            }
        )
    return items


def _normalized_next_gecko(raw: dict[str, Any]) -> dict[str, Any]:
    traits: list[str] = []
    raw_traits = raw.get("traits")
    if isinstance(raw_traits, list):
        for trait in raw_traits:
            text = _flight_text(trait)
            if text and text not in traits:
                traits.append(text)
    slug = _flight_text(raw.get("slug"))
    status = _flight_text(raw.get("status"))
    sold: Optional[bool]
    if status and status.lower() == "sold":
        sold = True
    elif status and status.lower() == "available":
        sold = False
    else:
        sold = None
    certified = raw.get("certified") if isinstance(raw.get("certified"), bool) else None
    return {
        "external_id": _flight_text(raw.get("id")) or slug or "",
        "title": _flight_text(raw.get("name")) or _flight_text(raw.get("id")) or "",
        "morph": _flight_text(raw.get("morph")),
        "sex": _flight_text(raw.get("sex")),
        "weight": _flight_text(raw.get("weight")),
        "lineage": _flight_text(raw.get("lineage")),
        "sire": _flight_text(raw.get("sire")),
        "dam": _flight_text(raw.get("dam")),
        "excerpt": "",
        "body": "",
        "price": _altitude_price_usd(raw.get("price")),
        "qty": _optional_observed_int(raw.get("qty")) if "qty" in raw else None,
        "sold": sold,
        "image": _altitude_image_url(raw.get("photo")),
        "path": f"/geckos/{slug}" if slug else "",
        "species_text": _flight_text(raw.get("species")) or "",
        "category_text": "",
        "product_type": None,
        "category_ids": [],
        "category_labels": [],
        "status": status,
        "certified": certified,
        "shopify_handle": _flight_text(raw.get("shopifyHandle")),
        "variant_id": _flight_text(raw.get("variantId")),
        "traits": traits,
        "squarespace_item": None,
        "category_label_map": None,
    }


def altitude_catalog_items(html_text: str) -> list[dict[str, Any]]:
    """Read Altitude's public gecko catalog from a shop HTML document.

    The current site is a Next.js page at /geckos (``/shop`` redirects
    there). Product records are in the prerendered flight payload under
    ``geckos``, not in a Squarespace ``data-context`` attribute. Older
    saved pages that still have the product-list embed are accepted too.
    Raises ValueError when neither payload is present.
    """
    if "data-context" in html_text and "product-list" in html_text:
        try:
            payload = squarespace_product_payload(html_text)
        except ValueError:
            payload = None
        except Exception:
            # A broken legacy embed must not hide the current flight payload.
            payload = None
        if payload is not None:
            return _items_from_squarespace(payload)

    geckos = _next_flight_geckos(html_text)
    if geckos is None:
        raise ValueError("Altitude catalog payload was not found in shop HTML")
    return [
        _normalized_next_gecko(item)
        for item in geckos
        if isinstance(item, dict)
    ]


def altitude_catalog_item_is_crested(item: dict[str, Any]) -> bool:
    """Crested physical animal, for either the old or current catalog shape."""
    raw = item.get("squarespace_item")
    if isinstance(raw, dict):
        labels = item.get("category_label_map")
        return altitude_item_is_crested(
            raw,
            labels if isinstance(labels, dict) else None,
        )

    title = str(item.get("title") or "")
    morph = str(item.get("morph") or "")
    species = str(item.get("species_text") or "")
    category = str(item.get("category_text") or "")
    if is_merch_text(title, morph, category):
        return False
    if category and ALTITUDE_BLOCKED_CATEGORY_RE.search(category):
        return False
    classification = " ".join(
        part for part in (title, morph, species, category) if part
    )
    if is_crested_text(classification):
        return True
    if classification and OTHER_SPECIES_RE.search(classification):
        return False
    return bool(item.get("morph") and item.get("weight") and item.get("sex"))


def _altitude_title(title: str, morph: Optional[str]) -> str:
    if morph and morph.casefold() not in title.casefold():
        return f"{title} {morph}".strip()
    return title.strip()


def altitude_listing_from_item(
    item: dict[str, Any],
) -> Optional[tuple[dict[str, Any], Optional[str]]]:
    """Map one catalog item to a cross_platform row and its first image.

    Unobserved fields stay None. Quantity is stored only when the page
    actually reports it. The caller sets last_seen_at.
    """
    external_id = str(item.get("external_id") or "").strip()
    if not external_id:
        return None
    title = str(item.get("title") or "")
    morph = item.get("morph") if isinstance(item.get("morph"), str) else None
    excerpt = str(item.get("excerpt") or "")
    body = str(item.get("body") or "")
    path = str(item.get("path") or "").strip()
    listing_url = urljoin(ALTITUDE_ORIGIN + "/", path) if path else None
    image = item.get("image")
    if not (isinstance(image, str) and image.startswith(("http://", "https://"))):
        image = None
    description = re.sub(r"<[^>]+>", " ", excerpt)
    description = re.sub(r"\s+", " ", description).strip()[:2000] or None
    blob_parts = [title, morph, excerpt, body, item.get("species_text")]
    group_lot = is_group_lot_text(*blob_parts)
    skip_combo = bool(
        re.search(r"hand-?picked hatchling", f"{title} {morph or ''}", re.IGNORECASE)
    ) or exclude_from_combo_arb(*blob_parts)
    fields: dict[str, str] = {}
    for key, source in (
        ("morph", morph),
        ("weight", item.get("weight")),
        ("sex", item.get("sex")),
        ("lineage", item.get("lineage")),
    ):
        if isinstance(source, str) and source.strip():
            fields[key] = source.strip()
    payload: dict[str, Any] = {
        "sex": item.get("sex"),
        "size": item.get("weight"),
        "lineage": item.get("lineage"),
        "sold": item.get("sold"),
        "qty": item.get("qty"),
        "images": [image] if image else [],
        "source_url": listing_url,
        "shop": "altitude_exotics",
        "is_group_lot": group_lot,
        "exclude_from_combo_arb": skip_combo,
        "morph": morph,
        "excerpt_fields": fields,
        "sku_title": title,
        "catalog_access": "robots_allowed_html",
        "training_rights": "permission_required",
        "training_eligible": False,
    }
    for key in (
        "sire",
        "dam",
        "status",
        "certified",
        "shopify_handle",
        "variant_id",
        "product_type",
    ):
        value = item.get(key)
        if value is not None:
            payload[key] = value
    category_ids = item.get("category_ids")
    if isinstance(category_ids, list) and category_ids:
        payload["category_ids"] = category_ids
        labels = item.get("category_labels")
        if isinstance(labels, list) and labels:
            payload["category_labels"] = labels
    trait_parts: list[Any] = [morph]
    raw_traits = item.get("traits")
    if isinstance(raw_traits, list):
        trait_parts.extend(raw_traits)
    trait_parts.append(title)
    row = {
        "platform": "altitude_exotics",
        "external_id": external_id,
        "title": _altitude_title(title, morph),
        "description": description,
        "price": item.get("price"),
        "price_usd_equivalent": item.get("price"),
        "currency": "USD",
        "seller_name": "Altitude Exotics",
        "seller_location": "Colorado US",
        "url": listing_url,
        "traits_raw": traits_csv(trait_parts),
        "species": CRESTED_SPECIES,
        "payload": payload,
    }
    return row, image


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
    if not isinstance(money, dict) and isinstance(variant.get("price"), dict):
        money = variant.get("price")
    if not isinstance(money, dict) and isinstance(item.get("price"), dict):
        money = item.get("price")
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
