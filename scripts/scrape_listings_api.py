"""MorphMarket listings ingest via the public JSON API.

Two modes, selected by --mode or INGEST_MODE:

  windowed (default)  Crested geckos first_listed in WINDOW_HOURS
                      (default 168). New-ad enrichment. Never calls
                      mark_unseen_listings_inactive.
  catalog             Every animal MorphMarket currently lists, filtered
                      client-side to Crested Gecko. After a complete
                      walk, calls mark_unseen so stale live flags drop.
                      A truncated or aborted walk does not mark unseen.

Walks GET /api/v1/listings/?ordering=-first_posted&page_size=100.
category=crested-geckos is not a valid list filter; keep a row when
category_name is Crested Gecko, scientific name is Correlophus
ciliatus, or the path contains /crested-geckos/. Date field is
first_listed, never a renewal stamp.

Morph tags come only from cached_traits names, never the title.
Photos are images[].image originals, not signed webp. Dual-writes
listings (PK listing_id) and market_listings (id=mm_<numeric>).

Env vars:
  SUPABASE_URL / SUPABASE_SERVICE_KEY
  TRIGGERED_BY          optional label, defaults to 'manual'
  INGEST_MODE           windowed | catalog (overridden by --mode)
  WINDOW_HOURS          lookback for first_listed in windowed mode
  MAX_PAGES             list-page cap (windowed 250, catalog 800)
  MIN_CATALOG_WRITES    refuse mark_unseen below this many upserts
  DETAIL_SLEEP_S        pause between detail fetches (default 0.15)
"""
from __future__ import annotations

import argparse
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


def _min_catalog_writes() -> int:
    raw = os.environ.get("MIN_CATALOG_WRITES", "50")
    return max(1, int(raw))


def apply_cli_args(argv: Optional[list[str]] = None) -> None:
    """--mode overrides INGEST_MODE. Env alone is enough for Actions."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("windowed", "catalog"),
        help="windowed = 7-day first_listed pulse; catalog = full live recrawl",
    )
    args, _unknown = parser.parse_known_args(argv)
    if args.mode:
        os.environ["INGEST_MODE"] = args.mode


def ingest_mode() -> str:
    raw = (
        os.environ.get("INGEST_MODE")
        or os.environ.get("MODE")
        or "windowed"
    )
    text = raw.strip().lower()
    if text in ("catalog", "full", "recrawl"):
        return "catalog"
    return "windowed"


def catalog_walk_complete(
    *,
    aborted: bool,
    saw_natural_end: bool,
    hit_page_cap: bool,
) -> bool:
    """True only when the catalog was walked to its last page."""
    return (not aborted) and saw_natural_end and (not hit_page_cap)


def should_mark_unseen(
    *,
    mode: str,
    complete: bool,
    succeeded: int,
    min_writes: int,
) -> bool:
    return (
        mode == "catalog"
        and complete
        and succeeded >= min_writes
    )


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
    scientific_name = "Correlophus ciliatus"
    category_name = "Crested Geckos"
    if isinstance(cat, dict):
        scientific_name = cat.get("scientific_name") or scientific_name
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
        # first_seen_at is omitted so a recrawl cannot overwrite the
        # original discovery stamp. New rows pick up the table default.
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
            "species": "crested",
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
        # This walk only accepts crested geckos (is_crested gates every row),
        # so the species column can finally say so instead of defaulting to
        # 'unknown' on 100% of the catalogue as it did before migration 0042.
        "species": "crested",
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


def _canonical_ids_for(listing_id: str) -> list[str]:
    listing_id = listing_id.strip()
    if not listing_id:
        return []
    ids = [listing_id]
    if not listing_id.startswith("mm_"):
        ids.append(f"mm_{listing_id}")
    return ids


def leave_unseen_canonical_inactive(supabase, run_id: int) -> int:
    """Flip market_listings off live for rows the catalog did not re-see.

    mark_unseen_listings_inactive only updates public.listings. Public
    KPIs read market_listings.current_status, so zombies stay 'live'
    unless this follows. Status is 'removed', not 'sold': disappearance
    is not a confirmed sale and we do not invent a sold price. Last ask
    stays last ask.
    """
    run = (
        supabase.table("scrape_runs")
        .select("started_at")
        .eq("id", run_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not run or not run[0].get("started_at"):
        log("WARN: cannot sync canonical unseen; scrape_runs.started_at missing")
        return 0
    started = run[0]["started_at"]
    unseen: list[str] = []
    page_size = 1000
    offset = 0
    while True:
        chunk = (
            supabase.table("listings")
            .select("listing_id")
            .eq("is_active", False)
            .lt("last_seen_at", started)
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
        if not chunk:
            break
        for row in chunk:
            lid = str(row.get("listing_id") or "").strip()
            if lid:
                unseen.extend(_canonical_ids_for(lid))
        if len(chunk) < page_size:
            break
        offset += page_size

    unseen = list(dict.fromkeys(unseen))
    if not unseen:
        log("canonical unseen sync: no inactive listings older than this run")
        return 0

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    flipped = 0
    events: list[dict[str, Any]] = []
    batch_size = 200
    for i in range(0, len(unseen), batch_size):
        batch = unseen[i : i + batch_size]
        try:
            result = (
                supabase.table("market_listings")
                .update({"current_status": "removed"})
                .in_("id", batch)
                .eq("current_status", "live")
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            log(f"WARN: market_listings unseen update failed: {exc}")
            continue
        changed = [str(r.get("id")) for r in (result.data or []) if r.get("id")]
        flipped += len(changed)
        for listing_id in changed:
            events.append(
                {
                    "listing_id": listing_id,
                    "status": "removed",
                    "observed_at": now_iso,
                    "source": "catalog_unseen",
                }
            )
    for i in range(0, len(events), batch_size):
        try:
            supabase.table("listing_status_events").insert(
                events[i : i + batch_size]
            ).execute()
        except Exception as exc:  # noqa: BLE001
            log(f"WARN: listing_status_events removed insert failed: {exc}")
    log(
        f"canonical unseen sync: flipped {flipped} live market_listings "
        f"to removed (no sold price written)"
    )
    return flipped


def mark_unseen_after_complete_catalog(supabase, run_id: int) -> None:
    try:
        result = supabase.rpc(
            "mark_unseen_listings_inactive",
            {"target_run_id": run_id},
        ).execute()
        log(f"mark_unseen_listings_inactive returned {result.data}")
    except Exception as exc:  # noqa: BLE001
        log(f"WARN: mark_unseen_listings_inactive failed: {exc}")
        return
    try:
        leave_unseen_canonical_inactive(supabase, run_id)
    except Exception as exc:  # noqa: BLE001
        log(f"WARN: canonical unseen sync failed: {exc}")


def main() -> int:
    apply_cli_args()
    mode = ingest_mode()
    window_hours = _window_hours()
    # Catalog walks the whole live list; windowed only needs enough
    # newest-first pages to cover WINDOW_HOURS.
    default_pages = "800" if mode == "catalog" else "250"
    if os.environ.get("MAX_PAGES") is None:
        os.environ["MAX_PAGES"] = default_pages
    max_pages = _max_pages()
    sleep_s = _detail_sleep()
    min_writes = _min_catalog_writes()
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=window_hours)
    cutoff_date = cutoff.date()

    supabase = get_supabase()
    run_id = start_scrape_run(supabase)
    attempted = 0
    succeeded = 0
    failed = 0
    consecutive_empty = 0
    consecutive_fetch_failures = 0
    aborted = False
    saw_natural_end = False
    hit_page_cap = False

    if mode == "catalog":
        log(
            f"API catalog recrawl: MAX_PAGES={max_pages} "
            f"MIN_CATALOG_WRITES={min_writes}"
        )
    else:
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
            has_next = bool(payload.get("next"))
            if not results:
                consecutive_empty += 1
                if consecutive_empty >= EMPTY_PAGE_TOLERANCE:
                    log("stopping after consecutive empty list pages")
                    saw_natural_end = True
                    break
                if not has_next:
                    saw_natural_end = True
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
                if (
                    mode == "windowed"
                    and listed_date
                    and listed_date.date() < cutoff_date
                ):
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
                if listed_at is None:
                    listed_at = dt.datetime.now(dt.timezone.utc)
                if mode == "windowed" and listed_at < cutoff:
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
                label = "crested" if mode == "catalog" else "crested in window"
                log(f"page {page}: {len(page_rows)} {label}, wrote {wrote}")
            else:
                log(
                    f"page {page}: no "
                    f"{'crested' if mode == 'catalog' else 'in-window crested'} "
                    "listings"
                )

            if page >= max_pages:
                if has_next:
                    hit_page_cap = True
                    log(
                        f"page cap reached at {max_pages} with another page "
                        "remaining; walk is truncated"
                    )
                else:
                    saw_natural_end = True
                break

            if not has_next:
                saw_natural_end = True
                log("stopping: list API reported no next page")
                break

            if mode == "windowed":
                if in_window_on_page == 0:
                    consecutive_empty += 1
                    if consecutive_empty >= EMPTY_PAGE_TOLERANCE:
                        log(
                            "stopping: "
                            f"{consecutive_empty} list pages with no "
                            "first_listed-in-window ads"
                        )
                        saw_natural_end = True
                        break
                else:
                    consecutive_empty = 0

        complete = catalog_walk_complete(
            aborted=aborted,
            saw_natural_end=saw_natural_end,
            hit_page_cap=hit_page_cap,
        )
        if should_mark_unseen(
            mode=mode,
            complete=complete,
            succeeded=succeeded,
            min_writes=min_writes,
        ):
            mark_unseen_after_complete_catalog(supabase, run_id)
        elif mode == "catalog":
            log(
                "skipping mark_unseen_listings_inactive "
                f"(complete={complete} succeeded={succeeded} "
                f"min_writes={min_writes} hit_page_cap={hit_page_cap} "
                f"saw_natural_end={saw_natural_end})"
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
        log(
            f"done mode={mode} status={status} attempted={attempted} "
            f"succeeded={succeeded} failed={failed} complete={complete}"
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        aborted = True
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
