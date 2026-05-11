"""
Daily listings scrape. Walks the MorphMarket crested gecko grid (~264
pages), upserts each listing's summary fields into public.listings, and
marks any listings that were not seen this run as inactive.

Designed to be safe to run repeatedly. Every write is an UPSERT keyed on
listing_id, so re-runs cannot create duplicates. If the script crashes
halfway through, the next run picks up where this one left off as far as
the database is concerned (the in-memory page cursor restarts at 1, but
upserting already-seen listings is a cheap no-op).

Env vars consumed:
  DECODO_AUTH               Basic auth for Decodo scraper API
  SUPABASE_URL              geck-data project URL
  SUPABASE_SERVICE_KEY      service_role secret (or SUPABASE_SERVICE_ROLE_KEY)
  TRIGGERED_BY              optional label, defaults to 'manual'
  MM_BASE_URL               override the listing grid URL (default below)
  MAX_PAGES                 stop after N pages (smoke testing)
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import traceback
from typing import Any, Optional
from urllib.parse import urlencode

from lib.decodo_client import DecodoClient
from lib.supabase_client import get_supabase
from transform_and_load import (
    coerce_float,
    coerce_int,
    normalise_listing_id,
    parse_weight_grams,
    split_traits,
)

# Default listing grid URL. The local scraper used the same path.
# Sort by newest so most volatile data lands first; pagination handled
# below.
DEFAULT_BASE_URL = (
    "https://www.morphmarket.com/us/c/reptiles/lizards/crested-geckos"
)

# How aggressively to stop. If three pages in a row return zero listings
# we assume we walked past the end of the catalog and break.
EMPTY_PAGE_TOLERANCE = 3

# Tunable batch size for UPSERTs. Supabase HTTP POST stays comfortable
# under 100 rows per call.
UPSERT_BATCH_SIZE = 50

# Regex used to fish a JSON-LD product block out of a listing card. Each
# MorphMarket listing card embeds a JSON-LD blob with the structured
# product data we want.
JSONLD_PRODUCT_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
    re.DOTALL,
)


def log(message: str) -> None:
    """Print with timestamp and flush so GitHub Actions streams output live."""
    ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    print(f"[{ts}] {message}", flush=True)


def start_scrape_run(supabase) -> int:
    """Insert a scrape_runs row with status=running and return its id."""
    triggered_by = os.environ.get("TRIGGERED_BY", "manual")
    row = (
        supabase.table("scrape_runs")
        .insert(
            {
                "scrape_type": "listings",
                "status": "running",
                "triggered_by": triggered_by,
            }
        )
        .execute()
    )
    run_id = int(row.data[0]["id"])
    log(f"scrape_runs row created with id={run_id} triggered_by={triggered_by}")
    return run_id


def finalise_scrape_run(
    supabase,
    run_id: int,
    *,
    status: str,
    attempted: int,
    succeeded: int,
    failed: int,
    error_message: Optional[str] = None,
) -> None:
    """Patch the scrape_runs row with final counts and status."""
    supabase.table("scrape_runs").update(
        {
            "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "status": status,
            "records_attempted": attempted,
            "records_succeeded": succeeded,
            "records_failed": failed,
            "error_message": error_message,
        }
    ).eq("id", run_id).execute()
    log(
        f"scrape_runs id={run_id} closed: status={status} "
        f"attempted={attempted} succeeded={succeeded} failed={failed}"
    )


def listing_grid_url(base: str, page: int) -> str:
    """Build the listing grid URL for page N. Sorted by newest first."""
    qs = urlencode({"sort": "search-newest", "page": page})
    return f"{base}?{qs}"


def extract_listings_from_html(html: str) -> list[dict[str, Any]]:
    """Pull listing summary rows from a grid page HTML response.

    The MorphMarket grid embeds one JSON-LD <script> per listing card.
    Each card has a Product object with name, offers.price, image, url.
    We parse them all and surface what is useful for the summary upsert.
    """
    listings: list[dict[str, Any]] = []
    for raw in JSONLD_PRODUCT_RE.findall(html):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        # JSON-LD blocks can be a single object or an array.
        candidates = data if isinstance(data, list) else [data]
        for item in candidates:
            if not isinstance(item, dict):
                continue
            if item.get("@type") not in {"Product", "Offer"}:
                continue
            listing = _flatten_product_jsonld(item)
            if listing and listing.get("listing_id"):
                listings.append(listing)
    return listings


def _flatten_product_jsonld(item: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Map a JSON-LD Product block to a row for public.listings."""
    url = item.get("url") or item.get("@id")
    if not url:
        return None

    # MorphMarket URLs look like /us/c/reptiles/.../12345/. Strip trailing
    # slash and take the last path segment as the listing id.
    listing_id = normalise_listing_id(url.rstrip("/").split("/")[-1])
    if not listing_id:
        return None

    offer = item.get("offers") or {}
    if isinstance(offer, list) and offer:
        offer = offer[0]
    if not isinstance(offer, dict):
        offer = {}

    seller = item.get("seller") or {}
    if isinstance(seller, list) and seller:
        seller = seller[0]
    if not isinstance(seller, dict):
        seller = {}

    images_raw = item.get("image") or []
    if isinstance(images_raw, str):
        images = [images_raw]
    elif isinstance(images_raw, list):
        images = [str(u) for u in images_raw if u]
    else:
        images = []

    traits_raw = item.get("additionalProperty") or []
    trait_names = _extract_traits(traits_raw)

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()

    row = {
        "listing_id": listing_id,
        "listing_url": url,
        "name": item.get("name"),
        "price": coerce_float(offer.get("price")),
        "currency": offer.get("priceCurrency"),
        "availability": offer.get("availability"),
        "seller_name": seller.get("name"),
        "description": item.get("description"),
        "primary_image_url": images[0] if images else None,
        "all_image_urls": images or None,
        "image_count": len(images) or None,
        "traits": "|".join(trait_names) if trait_names else None,
        "trait_array": trait_names or None,
        "trait_count": len(trait_names) if trait_names else None,
        "last_seen_at": now_iso,
        "last_updated_at": now_iso,
        "is_active": True,
    }

    # Pull a few common additionalProperty values into top-level columns.
    for prop in traits_raw if isinstance(traits_raw, list) else []:
        if not isinstance(prop, dict):
            continue
        name = (prop.get("name") or "").strip().lower()
        value = prop.get("value")
        if not name or value is None:
            continue
        if name == "sex":
            row["sex"] = str(value)
        elif name in {"weight", "weight (g)"}:
            row["weight"] = str(value)
            row["weight_grams"] = parse_weight_grams(value)
        elif name == "maturity":
            row["maturity"] = str(value)
        elif name in {"birth date", "birthdate", "hatched"}:
            row["birth_date"] = str(value)

    # Drop keys whose value is None so the UPSERT does not overwrite
    # richer data captured by a previous detail scrape.
    return {k: v for k, v in row.items() if v is not None}


def _extract_traits(props: Any) -> list[str]:
    """Extract trait names from an additionalProperty list."""
    if not isinstance(props, list):
        return []
    traits: list[str] = []
    for prop in props:
        if not isinstance(prop, dict):
            continue
        name = (prop.get("name") or "").strip().lower()
        if name != "traits":
            continue
        value = prop.get("value")
        if isinstance(value, list):
            traits.extend(str(v).strip() for v in value if v)
        elif value:
            traits.extend(split_traits(value))
    return [t for t in traits if t]


def upsert_listings(supabase, run_id: int, rows: list[dict[str, Any]]) -> int:
    """UPSERT a batch of listings and append history rows. Returns succeeded count."""
    if not rows:
        return 0

    # Make sure every row has first_seen_at on insert. The DB default
    # handles new rows; for re-upserts the column is left alone because
    # we exclude it from the payload (UPSERT only overwrites supplied
    # keys when on_conflict is set).
    succeeded = 0
    for i in range(0, len(rows), UPSERT_BATCH_SIZE):
        chunk = rows[i : i + UPSERT_BATCH_SIZE]
        try:
            supabase.table("listings").upsert(
                chunk, on_conflict="listing_id"
            ).execute()
        except Exception as exc:  # noqa: BLE001
            log(f"WARN: upsert failed for chunk of {len(chunk)}: {exc}")
            continue

        history_rows = [
            {
                "listing_id": r["listing_id"],
                "scrape_run_id": run_id,
                "price": r.get("price"),
                "is_active": True,
                "raw_snapshot": {
                    k: v
                    for k, v in r.items()
                    if k != "raw_snapshot"
                },
            }
            for r in chunk
        ]
        try:
            supabase.table("listings_history").insert(history_rows).execute()
        except Exception as exc:  # noqa: BLE001
            log(f"WARN: listings_history insert failed: {exc}")
        succeeded += len(chunk)
    return succeeded


def main() -> int:
    base = os.environ.get("MM_BASE_URL", DEFAULT_BASE_URL)
    max_pages_env = os.environ.get("MAX_PAGES")
    max_pages = int(max_pages_env) if max_pages_env else 400

    supabase = get_supabase()
    decodo = DecodoClient()

    run_id = start_scrape_run(supabase)
    attempted = 0
    succeeded = 0
    failed = 0
    consecutive_empty = 0

    try:
        for page in range(1, max_pages + 1):
            url = listing_grid_url(base, page)
            log(f"GET page {page}: {url}")
            attempted += 1
            try:
                resp = decodo.fetch(url, headless="html")
            except Exception as exc:  # noqa: BLE001
                log(f"ERROR fetching page {page}: {exc}")
                failed += 1
                continue

            if resp.status_code != 200:
                log(
                    f"WARN: page {page} returned status={resp.status_code}; "
                    "treating as empty"
                )
                consecutive_empty += 1
                if consecutive_empty >= EMPTY_PAGE_TOLERANCE:
                    log(
                        f"stopping after {consecutive_empty} non-200 pages in a row"
                    )
                    break
                continue

            listings = extract_listings_from_html(resp.html)
            log(f"page {page}: parsed {len(listings)} listings")
            if not listings:
                consecutive_empty += 1
                if consecutive_empty >= EMPTY_PAGE_TOLERANCE:
                    log(
                        f"stopping after {consecutive_empty} empty pages in a row"
                    )
                    break
                continue

            consecutive_empty = 0
            succeeded += upsert_listings(supabase, run_id, listings)

        # Mark anything we did not see during this run as inactive.
        try:
            result = supabase.rpc(
                "mark_unseen_listings_inactive",
                {"target_run_id": run_id},
            ).execute()
            log(f"mark_unseen_listings_inactive returned {result.data}")
        except Exception as exc:  # noqa: BLE001
            log(f"WARN: mark_unseen_listings_inactive failed: {exc}")

        status = "success" if failed == 0 else "partial"
        finalise_scrape_run(
            supabase,
            run_id,
            status=status,
            attempted=attempted,
            succeeded=succeeded,
            failed=failed,
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        log(f"FATAL: {exc}")
        traceback.print_exc()
        finalise_scrape_run(
            supabase,
            run_id,
            status="failed",
            attempted=attempted,
            succeeded=succeeded,
            failed=failed + 1,
            error_message=str(exc),
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
