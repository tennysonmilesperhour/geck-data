"""
Shared transformation helpers used by every scrape script.

Why this lives in its own module: the three scrapers (listings, details,
images) all need the same field-coercion logic, and the original local
migrate_to_supabase.py grew organically until it was thousands of lines
with copy/paste. One place, one set of behaviours.

Every function in here is pure (no I/O, no globals) so unit testing is
easy and the logic is auditable.
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Optional

_WEIGHT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([a-zA-Z]+)")


def parse_weight_grams(raw: Any) -> Optional[float]:
    """Convert a weight string like '25g', '0.06 kg', '1.2 oz' to grams.

    Returns None if the input is empty, not a string, or unrecognised.
    Be permissive: the source data is messy and we would rather drop a
    weight than crash the whole import.
    """
    if raw is None:
        return None
    text = str(raw).strip().lower()
    if not text or text in {"n/a", "na", "none", "-"}:
        return None

    match = _WEIGHT_RE.search(text)
    if not match:
        # Sometimes the field is just a bare number; assume grams.
        try:
            return float(text)
        except ValueError:
            return None

    value = float(match.group(1))
    unit = match.group(2)

    if unit.startswith("g"):
        return value
    if unit.startswith("kg"):
        return value * 1000.0
    if unit.startswith("oz"):
        return value * 28.3495
    if unit.startswith("lb"):
        return value * 453.592
    # Unknown unit, return the bare number rather than fabricate a value.
    return value


def split_traits(raw: Any) -> list[str]:
    """Split a pipe-delimited or comma-delimited traits string into a list.

    MorphMarket uses pipes ('Lily White | Pinstripe | Harlequin'). Some
    older CSV rows use commas. Be flexible. Returns an empty list on
    falsy input.
    """
    if raw is None:
        return []
    text = str(raw).strip()
    if not text:
        return []
    # Prefer pipe split because trait names can contain commas (rare).
    if "|" in text:
        parts = text.split("|")
    else:
        parts = text.split(",")
    return [p.strip() for p in parts if p and p.strip()]


def coerce_int(raw: Any) -> Optional[int]:
    """Best-effort int parse, returns None on failure."""
    if raw is None or raw == "":
        return None
    try:
        return int(float(str(raw).strip()))
    except (ValueError, TypeError):
        return None


def coerce_float(raw: Any) -> Optional[float]:
    """Best-effort float parse, returns None on failure."""
    if raw is None or raw == "":
        return None
    try:
        return float(str(raw).strip().replace("$", "").replace(",", ""))
    except (ValueError, TypeError):
        return None


def coerce_bool(raw: Any) -> Optional[bool]:
    """Parse common truthy/falsy spellings, returns None when unknown."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().lower()
    if text in {"true", "t", "yes", "y", "1"}:
        return True
    if text in {"false", "f", "no", "n", "0"}:
        return False
    return None


def normalise_listing_id(raw: Any) -> Optional[str]:
    """Strip whitespace and reject empty strings.

    listing_id is the primary key of the listings table; we never want
    blank or whitespace-only ids in there.
    """
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def chunked(seq: Iterable, size: int) -> Iterable[list]:
    """Yield successive chunks of `size` from `seq`. Used for batched upserts."""
    batch: list = []
    for item in seq:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch
