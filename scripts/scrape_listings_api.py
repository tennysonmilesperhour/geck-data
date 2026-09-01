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
  MORPHMARKET_PROXY_URL optional residential/mobile proxy used after a 403
  TRIGGERED_BY          optional label, defaults to 'manual'
  INGEST_MODE           windowed | catalog (overridden by --mode)
  WINDOW_HOURS          lookback for first_listed in windowed mode
  MAX_PAGES             list-page cap (windowed 250, catalog 800)
  MIN_CATALOG_WRITES    refuse mark_unseen below this many upserts
  DETAIL_SLEEP_S        pause between detail fetches (default 0.15)
  PAGE_SLEEP_S          pause between list pages (default 0.5)
"""
from __future__ import annotations

import argparse
import datetime as dt
import html as html_lib
import json
import os
import re
import sys
import time
import traceback
from typing import Any, Optional
from urllib.parse import unquote, urlencode, urlsplit

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

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
MIN_DETAIL_SLEEP_S = 0.15
MIN_PAGE_SLEEP_S = 0.5

_SELLER_ANCHOR_RE = re.compile(
    r'<a\b[^>]*\bhref=["\']/stores/(?P<slug>[^/"\']+)/?["\'][^>]*>'
    r"(?P<body>.*?)</a>",
    re.IGNORECASE | re.DOTALL,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")


class MorphMarketFetchError(RuntimeError):
    """A browser fetch failed without exposing proxy credentials."""


class MorphMarketAccessDeniedError(MorphMarketFetchError):
    """A 403 could not be cleared directly or with the configured proxy."""


def _proxy_settings(raw_url: str) -> dict[str, str]:
    """Translate a proxy URL into Playwright's split credential fields."""
    candidate = raw_url.strip()
    if not candidate:
        raise ValueError("MORPHMARKET_PROXY_URL is empty")
    if "://" not in candidate:
        candidate = f"http://{candidate}"
    parsed = urlsplit(candidate)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https", "socks4", "socks5"}:
        raise ValueError(
            "MORPHMARKET_PROXY_URL must use http, https, socks4, or socks5"
        )
    if not parsed.hostname:
        raise ValueError("MORPHMARKET_PROXY_URL is missing a hostname")
    host = parsed.hostname
    if ":" in host:
        host = f"[{host}]"
    try:
        port = f":{parsed.port}" if parsed.port else ""
    except ValueError as exc:
        raise ValueError("MORPHMARKET_PROXY_URL has an invalid port") from exc
    settings = {"server": f"{scheme}://{host}{port}"}
    if parsed.username is not None:
        settings["username"] = unquote(parsed.username)
    if parsed.password is not None:
        settings["password"] = unquote(parsed.password)
    return settings


class MorphMarketFetcher:
    """Reuse one real Chromium browser for list and detail requests."""

    def __init__(self) -> None:
        self.proxy_url = os.environ.get("MORPHMARKET_PROXY_URL", "").strip()
        self.browser_channel = (
            os.environ.get("MORPHMARKET_BROWSER_CHANNEL", "chromium").strip()
            or "chromium"
        )
        self.last_status: Optional[int] = None
        self._using_proxy = False
        self._playwright = sync_playwright().start()
        self._browser = None
        self._context = None
        self._page = None
        try:
            self._launch(use_proxy=False)
        except Exception:
            self.close()
            raise

    def __enter__(self) -> "MorphMarketFetcher":
        return self

    def __exit__(self, *_args: Any) -> None:
        self.close()

    def _launch(self, *, use_proxy: bool) -> None:
        proxy = _proxy_settings(self.proxy_url) if use_proxy else None
        try:
            self._browser = self._playwright.chromium.launch(
                channel=self.browser_channel,
                headless=True,
                proxy=proxy,
            )
            self._context = self._browser.new_context(locale="en-US")
            self._page = self._context.new_page()
            self._page.set_default_timeout(REQUEST_TIMEOUT_S * 1000)
            self._using_proxy = use_proxy
        except PlaywrightError as exc:
            where = " with MORPHMARKET_PROXY_URL" if use_proxy else ""
            raise MorphMarketFetchError(
                f"could not start Chromium{where}; install it with "
                "'python -m playwright install chromium'"
            ) from exc

    def _restart_with_proxy(self) -> None:
        if self._browser is not None:
            self._browser.close()
        self._browser = None
        self._context = None
        self._page = None
        self._launch(use_proxy=True)

    def _safe_error(self, exc: Exception) -> str:
        text = str(exc)
        if self.proxy_url:
            text = text.replace(self.proxy_url, "[MORPHMARKET_PROXY_URL]")
            try:
                proxy = _proxy_settings(self.proxy_url)
            except ValueError:
                proxy = {}
            for key in ("username", "password"):
                secret = proxy.get(key)
                if secret:
                    text = text.replace(secret, "[redacted]")
        return text

    def _fetch_bytes(self, url: str) -> bytes:
        if self._page is None:
            raise MorphMarketFetchError("Chromium page is not available")
        try:
            response = self._page.goto(
                url,
                wait_until="domcontentloaded",
                timeout=REQUEST_TIMEOUT_S * 1000,
            )
        except PlaywrightError as exc:
            route = " through MORPHMARKET_PROXY_URL" if self._using_proxy else ""
            raise MorphMarketFetchError(
                f"MorphMarket browser request failed{route}: "
                f"{self._safe_error(exc)}"
            ) from exc
        if response is None:
            raise MorphMarketFetchError("MorphMarket browser returned no response")

        self.last_status = response.status
        if response.status == 403 and not self._using_proxy:
            if not self.proxy_url:
                raise MorphMarketAccessDeniedError(
                    "MorphMarket returned HTTP 403. Add a residential or mobile "
                    "proxy URL as the GitHub Actions secret "
                    "MORPHMARKET_PROXY_URL. Decodo is not supported."
                )
            log(
                "MorphMarket returned HTTP 403 directly; retrying through "
                "MORPHMARKET_PROXY_URL"
            )
            try:
                self._restart_with_proxy()
            except Exception as exc:  # noqa: BLE001
                raise MorphMarketAccessDeniedError(
                    "MorphMarket returned HTTP 403 directly and the browser "
                    "could not start with MORPHMARKET_PROXY_URL: "
                    f"{self._safe_error(exc)}"
                ) from exc
            return self._fetch_bytes(url)
        if response.status == 403:
            raise MorphMarketAccessDeniedError(
                "MorphMarket returned HTTP 403 through MORPHMARKET_PROXY_URL; "
                "verify that it is an active residential or mobile proxy"
            )
        if response.status != 200:
            route = " through MORPHMARKET_PROXY_URL" if self._using_proxy else ""
            raise MorphMarketFetchError(
                f"MorphMarket returned HTTP {response.status}{route}"
            )
        try:
            return response.body()
        except PlaywrightError as exc:
            raise MorphMarketFetchError(
                f"could not read MorphMarket response body: {self._safe_error(exc)}"
            ) from exc

    def fetch_json(self, url: str) -> dict[str, Any]:
        raw = self._fetch_bytes(url)
        try:
            payload = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise MorphMarketFetchError(
                "MorphMarket returned HTTP 200 with invalid JSON"
            ) from exc
        if not isinstance(payload, dict):
            raise MorphMarketFetchError(
                "MorphMarket returned HTTP 200 with a non-object JSON payload"
            )
        return payload

    def fetch_text(self, url: str) -> str:
        return self._fetch_bytes(url).decode("utf-8", errors="replace")

    def close(self) -> None:
        if self._browser is not None:
            try:
                self._browser.close()
            except PlaywrightError:
                pass
        self._browser = None
        self._context = None
        self._page = None
        if self._playwright is not None:
            try:
                self._playwright.stop()
            except PlaywrightError:
                pass
            self._playwright = None


def _window_hours() -> int:
    raw = os.environ.get("WINDOW_HOURS", "168")
    return max(1, int(raw))


def _max_pages() -> int:
    raw = os.environ.get("MAX_PAGES", "250")
    return max(1, int(raw))


def _detail_sleep() -> float:
    raw = os.environ.get("DETAIL_SLEEP_S", "0.15")
    return max(MIN_DETAIL_SLEEP_S, float(raw))


def _page_sleep() -> float:
    raw = os.environ.get("PAGE_SLEEP_S", "0.5")
    return max(MIN_PAGE_SLEEP_S, float(raw))


def _min_catalog_writes() -> int:
    raw = os.environ.get("MIN_CATALOG_WRITES", "50")
    return max(1, int(raw))


def apply_cli_args(argv: Optional[list[str]] = None) -> bool:
    """--mode overrides INGEST_MODE. Env alone is enough for Actions."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("windowed", "catalog"),
        help="windowed = 7-day first_listed pulse; catalog = full live recrawl",
    )
    parser.add_argument(
        "--dry-run-page-one",
        action="store_true",
        help="fetch list page 1, print one crested row, and do not write",
    )
    args, _unknown = parser.parse_known_args(argv)
    if args.mode:
        os.environ["INGEST_MODE"] = args.mode
    return bool(args.dry_run_page_one)


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
    cat = str(item.get("category_name") or "").strip().lower()
    sci = str(item.get("category_scientific_name") or "").strip().lower()
    path = str(item.get("path") or item.get("share_url") or "")
    cat_obj = item.get("category") or {}
    if isinstance(cat_obj, dict):
        cat = cat or str(
            cat_obj.get("name_s") or cat_obj.get("name") or ""
        ).strip().lower()
        sci = sci or str(cat_obj.get("scientific_name") or "").strip().lower()
    return (
        cat in {"crested gecko", "crested geckos"}
        or sci == "correlophus ciliatus"
        or "/crested-geckos/" in path.lower()
    )


def list_page_has_next(payload: dict[str, Any]) -> bool:
    """Handle both paginated payload shapes seen on the public API."""
    if "next" in payload:
        return bool(payload.get("next"))
    results = payload.get("results") or []
    return isinstance(results, list) and len(results) >= PAGE_SIZE


def fetch_list_page(
    page: int, fetcher: MorphMarketFetcher
) -> dict[str, Any]:
    query = urlencode(
        {
            "ordering": "-first_posted",
            "page_size": PAGE_SIZE,
            "page": page,
        }
    )
    return fetcher.fetch_json(f"{LIST_URL}?{query}")


def fetch_detail(
    listing_id: str, fetcher: MorphMarketFetcher
) -> dict[str, Any]:
    return fetcher.fetch_json(DETAIL_URL.format(id=listing_id))


def extract_seller_from_html(html: str) -> tuple[Optional[str], Optional[str]]:
    """Extract a real store slug and visible name from rendered HTML."""
    if not html:
        return None, None
    match = _SELLER_ANCHOR_RE.search(html)
    if not match:
        return None, None
    slug = html_lib.unescape(match.group("slug")).strip() or None
    raw_name = _HTML_TAG_RE.sub(" ", match.group("body"))
    name = " ".join(html_lib.unescape(raw_name).split()) or None
    return slug, name


def seller_identity(
    detail: dict[str, Any], rendered_html: Optional[str] = None
) -> tuple[Optional[str], Optional[str]]:
    """Prefer API owner fields, then a rendered /stores/{slug}/ link."""
    owner = detail.get("owner") or {}
    seller_slug = None
    seller_name = None
    if isinstance(owner, dict):
        seller_slug = str(owner.get("id") or "").strip() or None
        seller_name = str(
            owner.get("person_name")
            or owner.get("clean_name")
            or owner.get("clean_label")
            or ""
        ).strip() or None
    seller_name = seller_name or str(detail.get("store") or "").strip() or None
    if not seller_slug and rendered_html:
        html_slug, html_name = extract_seller_from_html(rendered_html)
        seller_slug = html_slug
        seller_name = seller_name or html_name
    return seller_slug, seller_name


def _rendered_detail_url(
    detail: dict[str, Any], item: dict[str, Any]
) -> Optional[str]:
    raw = detail.get("share_url") or item.get("path") or item.get("share_url")
    if not isinstance(raw, str):
        return None
    parsed = urlsplit(raw)
    if parsed.scheme != "https" or parsed.hostname not in {
        "morphmarket.com",
        "www.morphmarket.com",
    }:
        return None
    return raw


def dry_run_page_one(fetcher: MorphMarketFetcher) -> int:
    """Prove the list endpoint and crested filter without touching Supabase."""
    payload = fetch_list_page(1, fetcher)
    print(f"HTTP {fetcher.last_status} MorphMarket list page 1", flush=True)
    for item in payload.get("results") or []:
        listing_id = str(item.get("key") or "").strip()
        if is_crested(item) and listing_id.isdigit():
            time.sleep(MIN_DETAIL_SLEEP_S)
            detail = fetch_detail(listing_id, fetcher)
            print(
                f"HTTP {fetcher.last_status} MorphMarket detail {listing_id}",
                flush=True,
            )
            if str(detail.get("id") or "").strip() != listing_id:
                print("Detail response did not match the list row", flush=True)
                return 1
            print(
                "Crested Gecko "
                f"listing_id={listing_id} title={item.get('title') or '(untitled)'}",
                flush=True,
            )
            return 0
    print("No Crested Gecko row with a numeric listing id was found", flush=True)
    return 1


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
    detail: dict[str, Any],
    listed_at: dt.datetime,
    rendered_html: Optional[str] = None,
) -> dict[str, Any]:
    listing_id = str(detail.get("id") or "").strip()
    names = trait_names(detail)
    images = original_image_urls(detail)
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    seller_slug, seller_name = seller_identity(detail, rendered_html)

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
    supabase,
    listing_id: str,
    detail: dict[str, Any],
    listed_at: dt.datetime,
    seller_slug: Optional[str],
) -> None:
    """Fill fields canonical.py cannot see (real seller slug, USD price)."""
    mm_id = f"mm_{listing_id}"
    owner = detail.get("owner") or {}
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
    if seller_slug:
        patch["seller_id"] = seller_slug
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


def mark_unseen_if_safe(
    supabase,
    run_id: int,
    *,
    mode: str,
    complete: bool,
    succeeded: int,
    min_writes: int,
) -> bool:
    """Run the inactive sweep only after a complete, sufficiently large catalog."""
    if not should_mark_unseen(
        mode=mode,
        complete=complete,
        succeeded=succeeded,
        min_writes=min_writes,
    ):
        return False
    mark_unseen_after_complete_catalog(supabase, run_id)
    return True


def main() -> int:
    dry_run = apply_cli_args()
    if dry_run:
        try:
            with MorphMarketFetcher() as fetcher:
                return dry_run_page_one(fetcher)
        except Exception as exc:  # noqa: BLE001
            log(f"DRY RUN FAILED: {exc}")
            return 1

    mode = ingest_mode()
    window_hours = _window_hours()
    # Catalog walks the whole live list; windowed only needs enough
    # newest-first pages to cover WINDOW_HOURS.
    default_pages = "800" if mode == "catalog" else "250"
    if os.environ.get("MAX_PAGES") is None:
        os.environ["MAX_PAGES"] = default_pages
    max_pages = _max_pages()
    sleep_s = _detail_sleep()
    page_sleep_s = _page_sleep()
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
    walk_incomplete = False
    saw_natural_end = False
    hit_page_cap = False
    fetcher: Optional[MorphMarketFetcher] = None

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
        fetcher = MorphMarketFetcher()
        for page in range(1, max_pages + 1):
            log(f"GET list page {page}")
            try:
                payload = fetch_list_page(page, fetcher)
            except MorphMarketAccessDeniedError:
                raise
            except Exception as exc:  # noqa: BLE001
                log(f"ERROR fetching list page {page}: {exc}")
                failed += 1
                walk_incomplete = True
                consecutive_fetch_failures += 1
                if consecutive_fetch_failures >= CONSECUTIVE_FETCH_FAILURE_LIMIT:
                    raise RuntimeError(
                        f"aborting: {consecutive_fetch_failures} list pages "
                        f"failed in a row; last error: {exc}"
                    ) from exc
                time.sleep(page_sleep_s)
                continue
            consecutive_fetch_failures = 0

            results = payload.get("results") or []
            has_next = list_page_has_next(payload)
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
            page_details: list[
                tuple[str, dict[str, Any], dt.datetime, Optional[str]]
            ] = []

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
                    detail = fetch_detail(listing_id, fetcher)
                    if sleep_s:
                        time.sleep(sleep_s)
                except MorphMarketAccessDeniedError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    log(f"WARN detail {listing_id}: {exc}")
                    failed += 1
                    if mode == "catalog":
                        walk_incomplete = True
                    continue

                listed_at = _parse_iso(detail.get("first_listed")) or listed_date
                if listed_at is None:
                    listed_at = dt.datetime.now(dt.timezone.utc)
                if mode == "windowed" and listed_at < cutoff:
                    continue
                if not is_crested(detail) and not is_crested(item):
                    continue
                rendered_html = None
                seller_slug, _seller_name = seller_identity(detail)
                if not seller_slug:
                    rendered_url = _rendered_detail_url(detail, item)
                    if rendered_url:
                        try:
                            rendered_html = fetcher.fetch_text(rendered_url)
                            if sleep_s:
                                time.sleep(sleep_s)
                        except Exception as exc:  # noqa: BLE001
                            log(
                                f"WARN seller HTML fallback {listing_id}: {exc}"
                            )
                row = detail_to_listing_row(
                    detail,
                    listed_at,
                    rendered_html=rendered_html,
                )
                if not row.get("listing_id"):
                    failed += 1
                    continue
                page_rows.append(row)
                page_details.append(
                    (row["listing_id"], detail, listed_at, row.get("seller_slug"))
                )

            if page_rows:
                consecutive_empty = 0
                wrote = upsert_listings(supabase, run_id, page_rows)
                succeeded += wrote
                for listing_id, detail, listed_at, seller_slug in page_details:
                    images = original_image_urls(detail)
                    write_image_and_gallery_rows(supabase, listing_id, images)
                    patch_canonical_extras(
                        supabase,
                        listing_id,
                        detail,
                        listed_at,
                        seller_slug,
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

            time.sleep(page_sleep_s)

        complete = catalog_walk_complete(
            aborted=aborted or walk_incomplete,
            saw_natural_end=saw_natural_end,
            hit_page_cap=hit_page_cap,
        )
        marked_unseen = mark_unseen_if_safe(
            supabase,
            run_id,
            mode=mode,
            complete=complete,
            succeeded=succeeded,
            min_writes=min_writes,
        )
        if not marked_unseen and mode == "catalog":
            log(
                "skipping mark_unseen_listings_inactive "
                f"(complete={complete} succeeded={succeeded} "
                f"min_writes={min_writes} hit_page_cap={hit_page_cap} "
                f"saw_natural_end={saw_natural_end} "
                f"walk_incomplete={walk_incomplete})"
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
    finally:
        if fetcher is not None:
            fetcher.close()


if __name__ == "__main__":
    sys.exit(main())
