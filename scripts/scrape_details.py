"""
Weekly listings-detail scrape. Walks the subset of listings that need
richer data (new since the last detail scrape, or older than 7 days) and
upserts the detail fields into public.listings.

Why incremental: a full re-scrape of every listing burns ~6,000 Decodo
Premium+JS credits. Our monthly cap is 19,000. Re-scraping only the
listings that actually need updating keeps us comfortably under budget.

Env vars consumed: DECODO_AUTH, SUPABASE_URL, SUPABASE_SERVICE_KEY,
TRIGGERED_BY, MAX_LISTINGS (optional cap for smoke tests).

Concurrency: 3 parallel workers with a 2 sec hard delay between requests
per worker. The Decodo wrapper enforces a global rate ceiling too, so we
stay under the 10 req/s plan limit.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, NamedTuple, Optional

from lib.budget import BudgetExceededError, DecodoBudget
from lib.decodo_client import DecodoClient
from lib.supabase_client import get_supabase
from transform_and_load import (
    coerce_float,
    normalise_listing_id,
    parse_weight_grams,
    split_traits,
)

WORKER_COUNT = 3

# If this many fetches in a row come back as hard failures (proxy quota
# exhausted, provider outage), abort the whole run as 'failed' instead of
# burning credits on the rest of the queue. Parse skips and write
# failures do not count; only fetch-layer exceptions do.
CONSECUTIVE_FETCH_FAILURE_LIMIT = 5
PER_WORKER_DELAY_SECONDS = 2.0

# Detail page status codes that mean the listing is permanently gone
# (sold, removed, expired). Anything else — 403 bot block, 5xx hiccup —
# is treated as transient and the listing stays active for a retry on
# the next pass.
DEACTIVATE_STATUSES = frozenset({404, 410})

JSONLD_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
    re.DOTALL,
)


# MorphMarket dropped the JSON-LD `seller` field from detail pages
# sometime around mid-May 2026, so we can't rely on Product.seller for
# seller info anymore. The rendered HTML still carries an anchor of the
# shape <a href="/stores/{slug}/"...>...storeName...{display name}...</a>
# in two places per page (mobile + desktop layouts). We pluck the slug
# and the display name from there.
_SELLER_ANCHOR_RE = re.compile(
    r'<a[^>]+href="/stores/(?P<slug>[^/"]+)/?"[^>]*>'
    r'.{0,500}?storeName[^"]*"[^>]*>(?P<name>[^<]+)<',
    re.DOTALL,
)


def _extract_seller_from_html(html: str) -> tuple[Optional[str], Optional[str]]:
    """Return (seller_slug, seller_name) from the rendered detail HTML.

    Both values may be None if the page doesn't expose them (sold-out
    listings sometimes hide the store link).
    """
    if not html:
        return None, None
    match = _SELLER_ANCHOR_RE.search(html)
    if not match:
        return None, None
    slug = match.group("slug").strip() or None
    name = match.group("name").strip() or None
    return slug, name


class FetchResult(NamedTuple):
    """One of: upsert a refreshed row, deactivate a gone listing, or skip."""

    action: str  # "upsert" | "deactivate" | "skip"
    listing_id: str
    row: Optional[dict[str, Any]] = None
    reason: Optional[str] = None


def log(message: str) -> None:
    ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    print(f"[{ts}] {message}", flush=True)


def start_scrape_run(supabase) -> int:
    triggered_by = os.environ.get("TRIGGERED_BY", "manual")
    row = (
        supabase.table("scrape_runs")
        .insert(
            {
                "scrape_type": "details",
                "status": "running",
                "triggered_by": triggered_by,
            }
        )
        .execute()
    )
    run_id = int(row.data[0]["id"])
    log(f"scrape_runs row created with id={run_id}")
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


def fetch_listing_detail(
    decodo: DecodoClient,
    listing: dict[str, Any],
) -> FetchResult:
    """Scrape one listing's detail page.

    Returns a FetchResult describing what the caller should do:
      - upsert:     the listing is still up; payload row is in `.row`
      - deactivate: MorphMarket returned 404/410 — listing is gone
      - skip:       transient error; leave the row alone, try next pass

    The per-worker delay is implemented here (time.sleep before fetch) so
    each worker pauses individually; the global rate cap in DecodoClient
    keeps total throughput safe.
    """
    time.sleep(PER_WORKER_DELAY_SECONDS)
    listing_id = str(listing.get("listing_id") or "")
    url = listing.get("listing_url")
    if not url:
        log(f"skip {listing_id}: no listing_url")
        return FetchResult(action="skip", listing_id=listing_id, reason="no_url")
    resp = decodo.fetch(url, headless="html")
    if resp.status_code in DEACTIVATE_STATUSES:
        log(f"listing {listing_id} status={resp.status_code}; marking inactive")
        return FetchResult(
            action="deactivate",
            listing_id=listing_id,
            reason=f"status_{resp.status_code}",
        )
    if resp.status_code != 200:
        log(f"WARN listing {listing_id} status={resp.status_code}")
        return FetchResult(
            action="skip",
            listing_id=listing_id,
            reason=f"status_{resp.status_code}",
        )
    parsed = parse_detail_html(resp.html, listing_id=listing["listing_id"])
    if not parsed:
        return FetchResult(action="skip", listing_id=listing_id, reason="no_jsonld")
    parsed["listing_url"] = url
    return FetchResult(action="upsert", listing_id=listing_id, row=parsed)


def parse_detail_html(html: str, *, listing_id: str) -> Optional[dict[str, Any]]:
    """Pull the rich Product JSON-LD out of a listing detail page."""
    product: Optional[dict[str, Any]] = None
    for raw in JSONLD_RE.findall(html):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        candidates = data if isinstance(data, list) else [data]
        for item in candidates:
            if isinstance(item, dict) and item.get("@type") == "Product":
                product = item
                break
        if product:
            break
    if not product:
        return None

    offer = product.get("offers") or {}
    if isinstance(offer, list) and offer:
        offer = offer[0]
    if not isinstance(offer, dict):
        offer = {}

    seller = product.get("seller") or {}
    if isinstance(seller, list) and seller:
        seller = seller[0]
    if not isinstance(seller, dict):
        seller = {}

    images_raw = product.get("image") or []
    if isinstance(images_raw, str):
        images = [images_raw]
    elif isinstance(images_raw, list):
        images = [str(u) for u in images_raw if u]
    else:
        images = []

    additional = product.get("additionalProperty") or []
    if not isinstance(additional, list):
        additional = []

    traits: list[str] = []
    extras: dict[str, str] = {}
    for prop in additional:
        if not isinstance(prop, dict):
            continue
        name = (prop.get("name") or "").strip()
        value = prop.get("value")
        if not name or value is None:
            continue
        lower = name.lower()
        if lower == "traits":
            if isinstance(value, list):
                traits.extend(str(v).strip() for v in value if v)
            else:
                traits.extend(split_traits(value))
        else:
            extras[lower] = str(value)

    # JSON-LD on detail pages no longer carries `seller.url`, so we pull
    # the slug (and the name as a fallback) from the rendered HTML.
    html_seller_slug, html_seller_name = _extract_seller_from_html(html)

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()

    # MorphMarket exposes the original listing date as an additionalProperty
    # entry on the detail page. We capture it both as the original raw text
    # (in `first_listed`) and as a typed timestamptz at UTC midnight (in
    # `first_listed_at`) so the trend queries can coalesce(first_listed_at,
    # first_seen_at) without doing per-row string parsing.
    first_listed_text = (
        extras.get("first listed")
        or extras.get("listed")
        or extras.get("date listed")
    )
    first_listed_at: Optional[str] = None
    if first_listed_text and re.fullmatch(r"\d{4}-\d{2}-\d{2}", first_listed_text.strip()):
        first_listed_at = f"{first_listed_text.strip()}T00:00:00+00:00"

    row: dict[str, Any] = {
        "listing_id": normalise_listing_id(listing_id),
        "name": product.get("name"),
        "description": product.get("description"),
        "price": coerce_float(offer.get("price")),
        "currency": offer.get("priceCurrency"),
        "availability": offer.get("availability"),
        "seller_name": seller.get("name") or html_seller_name,
        "seller_slug": html_seller_slug,
        "scientific_name": extras.get("scientific name"),
        "category": extras.get("category"),
        "sex": extras.get("sex"),
        "maturity": extras.get("maturity"),
        "weight": extras.get("weight"),
        "weight_grams": parse_weight_grams(extras.get("weight")),
        "birth_date": extras.get("birth date") or extras.get("birthdate"),
        "origin": extras.get("origin"),
        "pet_only": extras.get("pet only"),
        "lineage": extras.get("lineage"),
        "shipping_label": extras.get("shipping"),
        "payment_method": extras.get("payment"),
        "sku": product.get("sku"),
        "traits": "|".join(traits) if traits else None,
        "trait_array": traits or None,
        "trait_count": len(traits) if traits else None,
        "first_listed": first_listed_text,
        "first_listed_at": first_listed_at,
        "primary_image_url": images[0] if images else None,
        "all_image_urls": images or None,
        "image_count": len(images) or None,
        "last_seen_at": now_iso,
        "last_updated_at": now_iso,
        "is_active": True,
    }
    return {k: v for k, v in row.items() if v is not None}


def deactivate_listing(supabase, run_id: int, listing_id: str, reason: str) -> None:
    """Mark a listing inactive and append a history row noting the cause.

    Both writes are best-effort: a transient Supabase failure during
    deactivation should not block the rest of the run. The listing will
    show up again in listings_needing_detail_scrape next time and we'll
    retry the deactivation then.
    """
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        supabase.table("listings").update(
            {"is_active": False, "last_updated_at": now_iso}
        ).eq("listing_id", listing_id).execute()
    except Exception as exc:  # noqa: BLE001
        log(f"WARN deactivate update failed for {listing_id}: {exc}")
        return
    try:
        supabase.table("listings_history").insert(
            {
                "listing_id": listing_id,
                "scrape_run_id": run_id,
                "is_active": False,
                "raw_snapshot": {"reason": reason},
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001
        log(f"WARN deactivate history insert failed for {listing_id}: {exc}")


def main() -> int:
    max_listings_env = os.environ.get("MAX_LISTINGS")
    max_listings = int(max_listings_env) if max_listings_env else None

    supabase = get_supabase()
    budget = DecodoBudget(supabase)
    decodo = DecodoClient(budget=budget)

    run_id = start_scrape_run(supabase)
    attempted = 0
    succeeded = 0
    failed = 0
    deactivated = 0

    try:
        log("calling listings_needing_detail_scrape()")
        rpc_result = supabase.rpc(
            "listings_needing_detail_scrape", {"stale_after_days": 7}
        ).execute()
        todo: list[dict[str, Any]] = rpc_result.data or []
        if max_listings:
            todo = todo[:max_listings]
        log(f"need to scrape {len(todo)} listings")

        if not todo:
            finalise_scrape_run(
                supabase,
                run_id,
                status="success",
                attempted=0,
                succeeded=0,
                failed=0,
            )
            return 0

        consecutive_fetch_failures = 0
        with ThreadPoolExecutor(max_workers=WORKER_COUNT) as pool:
            futures = {
                pool.submit(fetch_listing_detail, decodo, listing): listing
                for listing in todo
            }
            for future in as_completed(futures):
                listing = futures[future]
                attempted += 1
                try:
                    result = future.result()
                except BudgetExceededError:
                    # Monthly quota threshold hit; stop the whole run now.
                    pool.shutdown(wait=False, cancel_futures=True)
                    raise
                except Exception as exc:  # noqa: BLE001
                    log(f"ERROR listing {listing.get('listing_id')}: {exc}")
                    failed += 1
                    consecutive_fetch_failures += 1
                    if consecutive_fetch_failures >= CONSECUTIVE_FETCH_FAILURE_LIMIT:
                        # Cancel everything still queued so the with-block
                        # does not sit around executing doomed fetches.
                        pool.shutdown(wait=False, cancel_futures=True)
                        raise RuntimeError(
                            f"aborting run: {consecutive_fetch_failures} fetches "
                            f"failed in a row; last error: {exc}"
                        ) from exc
                    continue
                consecutive_fetch_failures = 0

                if result.action == "deactivate":
                    deactivate_listing(
                        supabase, run_id, result.listing_id, result.reason or "gone"
                    )
                    deactivated += 1
                    succeeded += 1
                elif result.action == "upsert" and result.row:
                    row = result.row
                    try:
                        supabase.table("listings").upsert(
                            row, on_conflict="listing_id"
                        ).execute()
                        supabase.table("listings_history").insert(
                            {
                                "listing_id": row["listing_id"],
                                "scrape_run_id": run_id,
                                "price": row.get("price"),
                                "is_active": True,
                                "raw_snapshot": row,
                            }
                        ).execute()
                        succeeded += 1
                    except Exception as exc:  # noqa: BLE001
                        log(
                            f"WARN write failed for {row.get('listing_id')}: {exc}"
                        )
                        failed += 1
                else:
                    # skip: transient error or unparseable page; try next pass
                    failed += 1

                if attempted % 25 == 0:
                    log(
                        f"progress: attempted={attempted} succeeded={succeeded} "
                        f"deactivated={deactivated} failed={failed}"
                    )

        log(
            f"final tally: attempted={attempted} succeeded={succeeded} "
            f"deactivated={deactivated} failed={failed}"
        )
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
    finally:
        budget.flush()


if __name__ == "__main__":
    sys.exit(main())
