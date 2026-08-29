"""Windowed MorphMarket listings ingest via the public JSON API.

Walks GET /api/v1/listings/?ordering=-first_posted, keeps Crested Geckos
whose first_listed timestamp falls inside WINDOW_HOURS (default 168,
one week), then fetches each listing detail for morph tags and original
photo URLs.

Morph tags come only from cached_traits on the detail payload, never
from the title. Traits are stored comma-space delimited so the 0037
combo views (which split on commas) can see them.

Does not use Decodo. Does not call mark_unseen_listings_inactive: this
is a windowed walk, not a full catalog sweep. The paused weekly resync
workflow still owns that hygiene job.

Env vars:
  SUPABASE_URL / SUPABASE_SERVICE_KEY
  TRIGGERED_BY          optional label, defaults to 'manual'
  WINDOW_HOURS          lookback for first_listed (default 168)
  MAX_PAGES             list-page cap (default 250)
  DETAIL_SLEEP_S        pause between detail fetches (default 0.15)
"""
from __future__ import annotations

import datetime as dt
import os
import sys
import time
import traceback
from typing import Any, Optional

import requests

from lib.supabase_client import get_supabase
from scrape_listings import (
    finalise_scrape_run,
    log,
    start_scrape_run,
    upsert_listings,
)

LIST_URL = "https://www.morphmarket.com/api/v1/listings/"
DETAIL_URL = "https://www.morphmarket.com/api/v1/listings/{id}/"
PAGE_SIZE = 100
EMPTY_PAGE_TOLERANCE = 3
CONSECUTIVE_FETCH_FAILURE_LIMIT = 5
REQUEST_TIMEOUT_S = 45
USER_AGENT = "GeckDataBot/1.0 (crested gecko market tracker)"

SESSION = requests.Session()
SESSION.headers.update(
    {
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }
)


def _window_hours() -> int:
    raw = os.environ.get("WINDOW_HOURS", "168")
    return max(1, int(raw))


def _max_pages() -> int:
    raw = os.environ.get("MAX_PAGES", "250")
    return max(1, int(raw))


def _detail_sleep() -> float:
    raw = os.environ.get("DETAIL_SLEEP_S", "0.15")
    return max(0.0, float(raw))


def _parse_iso(value: Any) -> Optional[dt.datetime]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = dt.datetime.strptime(text[:10], "%Y-%m-%d")
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def is_crested(item: dict[str, Any]) -> bool:
    cat = str(item.get("category_name") or "")
    sci = str(item.get("category_scientific_name") or "")
    path = str(item.get("path") or item.get("share_url") or "")
    cat_obj = item.get("category") or {}
    if isinstance(cat_obj, dict):
        cat = cat or str(cat_obj.get("name") or cat_obj.get("name_s") or "")
        sci = sci or str(cat_obj.get("scientific_name") or "")
    blob = f"{cat} {sci} {path}".lower()
    return (
        "crested gecko" in blob
        or "crested-geckos" in blob
        or "correlophus ciliatus" in blob
    )


def fetch_list_page(page: int) -> dict[str, Any]:
    resp = SESSION.get(
        LIST_URL,
        params={
            "ordering": "-first_posted",
            "page_size": PAGE_SIZE,
            "page": page,
        },
        timeout=REQUEST_TIMEOUT_S,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_detail(listing_id: str) -> dict[str, Any]:
    resp = SESSION.get(
        DETAIL_URL.format(id=listing_id),
        timeout=REQUEST_TIMEOUT_S,
    )
    resp.raise_for_status()
    return resp.json()


def original_image_urls(detail: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for image in detail.get("images") or []:
        if not isinstance(image, dict):
            continue
        raw = image.get("image")
        if isinstance(raw, str) and raw.startswith("http"):
            urls.append(raw)
    best = detail.get("best_detail_image") or {}
    if isinstance(best, dict):
        original = best.get("original_url")
        if isinstance(original, str) and original.startswith("http"):
            if original not in urls:
                urls.insert(0, original)
    return urls


def trait_names(detail: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for trait in detail.get("cached_traits") or []:
        if not isinstance(trait, dict):
            continue
        name = str(trait.get("name") or "").strip()
        if name and name not in names:
            names.append(name)
    return names


def detail_to_listing_row(
    detail: dict[str, Any], listed_at: dt.datetime
) -> dict[str, Any]:
    listing_id = str(detail.get("id") or "").strip()
    names = trait_names(detail)
    images = original_image_urls(detail)
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    listed_iso = listed_at.isoformat()
    owner = detail.get("owner") or {}
    seller_slug = None
    seller_name = None
    if isinstance(owner, dict):
        seller_slug = owner.get("id") or None
        seller_name = owner.get("person_name") or owner.get("id")
    seller_name = seller_name or detail.get("store")
    seller_slug = seller_slug or detail.get("store")

    state = str(detail.get("state") or "for_sale")
    currency = detail.get("localized_price_currency") or "USD"
    if currency in ("$", "US$"):
        currency = "USD"

    sex = detail.get("sex")
    if isinstance(sex, str):
        sex = sex.strip().lower()

    maturity = detail.get("maturity_display") or detail.get("maturity")
    if isinstance(maturity, str):
        maturity = maturity.strip().title()

    cat = detail.get("category") or {}
    scientific_name = None
    category_name = "Crested Geckos"
    if isinstance(cat, dict):
        scientific_name = cat.get("scientific_name")
        category_name = cat.get("name") or category_name

    origin = detail.get("item_origin")
    birth = detail.get("birth_date")
    birth_str = None
    if isinstance(birth, dict):
        y, m, d = birth.get("year"), birth.get("month"), birth.get("day")
        if y:
            if m and d:
                birth_str = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
            else:
                birth_str = str(int(y))
    elif birth:
        birth_str = str(birth)

    share = detail.get("share_url") or ""
    row: dict[str, Any] = {
        "listing_id": listing_id,
        "listing_url": share,
        "name": detail.get("clean_title") or detail.get("title"),
        "price": detail.get("price"),
        "currency": currency,
        "availability": state,
        "seller_name": seller_name,
        "seller_slug": seller_slug,
        "description": detail.get("desc") or detail.get("display_description"),
        "primary_image_url": images[0] if images else None,
        "all_image_urls": images or None,
        "image_count": len(images) or None,
        "traits": ", ".join(names) if names else None,
        "trait_array": names or None,
        "trait_count": len(names) if names else None,
        "sex": sex,
        "maturity": maturity,
        "weight": detail.get("weight"),
        "scientific_name": scientific_name,
        "category": category_name,
        "origin": origin,
        "birth_date": birth_str,
        "first_seen_at": listed_iso,
        "last_seen_at": now_iso,
        "last_updated_at": now_iso,
        "is_active": True,
    }
    return {k: v for k, v in row.items() if v is not None}


def write_image_and_gallery_rows(
    supabase, listing_id: str, images: list[str]
) -> None:
    if not images:
        return
    mm_id = f"mm_{listing_id}"
    key = int(listing_id)
    try:
        supabase.table("market_galleries").upsert(
            {
                "listing_key": key,
                "images": [{"image": url} for url in images],
                "image_count": len(images),
                "captured_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            },
            on_conflict="listing_key",
        ).execute()
    except Exception as exc:  # noqa: BLE001
        log(f"WARN: market_galleries upsert failed for {listing_id}: {exc}")

    existing: set[str] = set()
    try:
        found = (
            supabase.table("listing_images")
            .select("image_url")
            .eq("listing_id", mm_id)
            .execute()
            .data
            or []
        )
        existing = {str(r.get("image_url") or "") for r in found}
    except Exception as exc:  # noqa: BLE001
        log(f"WARN: listing_images lookup failed for {listing_id}: {exc}")

    new_rows = [
        {
            "listing_id": mm_id,
            "image_url": url,
            "storage_bucket": "listing-images",
            "species": "unknown",
        }
        for url in images
        if url not in existing
    ]
    if not new_rows:
        return
    try:
        supabase.table("listing_images").insert(new_rows).execute()
    except Exception as exc:  # noqa: BLE001
        log(f"WARN: listing_images insert failed for {listing_id}: {exc}")


def patch_canonical_extras(
    supabase, listing_id: str, detail: dict[str, Any], listed_at: dt.datetime
) -> None:
    """Fill fields canonical.py cannot see (real seller slug, USD price)."""
    mm_id = f"mm_{listing_id}"
    owner = detail.get("owner") or {}
    slug = None
    if isinstance(owner, dict):
        slug = owner.get("id")
    slug = slug or detail.get("store")
    patch: dict[str, Any] = {
        "first_listed": listed_at.isoformat(),
        "first_listed_at": listed_at.isoformat(),
        "detail_collected": True,
        "is_auction": bool(detail.get("auction")),
        "likes_count": detail.get("like_count"),
        "saved_count": detail.get("saved_count"),
        "bpg_tier": detail.get("bpg_tier"),
        "item_origin": detail.get("item_origin"),
        "proven_breeder": bool(detail.get("proven_breeder")),
        "norm_traits": detail.get("norm_traits"),
    }
    if slug:
        patch["seller_id"] = slug
    usd = detail.get("usd_price")
    if usd is not None:
        try:
            patch["price_usd_equivalent"] = float(usd)
        except (TypeError, ValueError):
            pass
    loc = None
    if isinstance(owner, dict):
        loc = owner.get("country_code") or owner.get("country")
    if loc:
        patch["seller_location"] = loc
    patch = {k: v for k, v in patch.items() if v is not None}
    if not patch:
        return
    try:
        supabase.table("market_listings").update(patch).eq("id", mm_id).execute()
    except Exception as exc:  # noqa: BLE001
        log(f"WARN: market_listings extra patch failed for {listing_id}: {exc}")


def main() -> int:
    window_hours = _window_hours()
    max_pages = _max_pages()
    sleep_s = _detail_sleep()
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=window_hours)
    cutoff_date = cutoff.date()

    supabase = get_supabase()
    run_id = start_scrape_run(supabase)
    attempted = 0
    succeeded = 0
    failed = 0
    consecutive_empty = 0
    consecutive_fetch_failures = 0

    log(
        f"API windowed ingest: WINDOW_HOURS={window_hours} "
        f"cutoff={cutoff.isoformat()} MAX_PAGES={max_pages}"
    )

    try:
        for page in range(1, max_pages + 1):
            log(f"GET list page {page}")
            try:
                payload = fetch_list_page(page)
            except Exception as exc:  # noqa: BLE001
                log(f"ERROR fetching list page {page}: {exc}")
                failed += 1
                consecutive_fetch_failures += 1
                if consecutive_fetch_failures >= CONSECUTIVE_FETCH_FAILURE_LIMIT:
                    raise RuntimeError(
                        f"aborting: {consecutive_fetch_failures} list pages "
                        f"failed in a row; last error: {exc}"
                    ) from exc
                continue
            consecutive_fetch_failures = 0

            results = payload.get("results") or []
            if not results:
                consecutive_empty += 1
                if consecutive_empty >= EMPTY_PAGE_TOLERANCE:
                    log("stopping after consecutive empty list pages")
                    break
                continue

            in_window_on_page = 0
            page_rows: list[dict[str, Any]] = []
            page_details: list[tuple[str, dict[str, Any], dt.datetime]] = []

            for item in results:
                listed_date = _parse_iso(item.get("first_listed"))
                if listed_date and listed_date.date() >= cutoff_date:
                    in_window_on_page += 1
                if not is_crested(item):
                    continue
                if listed_date and listed_date.date() < cutoff_date:
                    continue
                listing_id = str(item.get("key") or "").strip()
                if not listing_id:
                    continue
                attempted += 1
                try:
                    detail = fetch_detail(listing_id)
                    if sleep_s:
                        time.sleep(sleep_s)
                except Exception as exc:  # noqa: BLE001
                    log(f"WARN detail {listing_id}: {exc}")
                    failed += 1
                    continue

                listed_at = _parse_iso(detail.get("first_listed")) or listed_date
                if listed_at is None or listed_at < cutoff:
                    continue
                if not is_crested(detail) and not is_crested(item):
                    continue
                row = detail_to_listing_row(detail, listed_at)
                if not row.get("listing_id"):
                    failed += 1
                    continue
                page_rows.append(row)
                page_details.append((row["listing_id"], detail, listed_at))

            if page_rows:
                consecutive_empty = 0
                wrote = upsert_listings(supabase, run_id, page_rows)
                succeeded += wrote
                for listing_id, detail, listed_at in page_details:
                    images = original_image_urls(detail)
                    write_image_and_gallery_rows(supabase, listing_id, images)
                    patch_canonical_extras(
                        supabase, listing_id, detail, listed_at
                    )
                log(
                    f"page {page}: {len(page_rows)} crested in window, "
                    f"wrote {wrote}"
                )
            else:
                log(f"page {page}: no in-window crested listings")

            if in_window_on_page == 0:
                consecutive_empty += 1
                if consecutive_empty >= EMPTY_PAGE_TOLERANCE:
                    log(
                        "stopping: "
                        f"{consecutive_empty} list pages with no "
                        "first_listed-in-window ads"
                    )
                    break
            else:
                consecutive_empty = 0

        status = "success" if failed == 0 else "partial"
        finalise_scrape_run(
            supabase,
            run_id,
            status=status,
            attempted=attempted,
            succeeded=succeeded,
            failed=failed,
        )
        log(
            f"done status={status} attempted={attempted} "
            f"succeeded={succeeded} failed={failed}"
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
