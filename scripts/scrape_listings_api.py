"""MorphMarket listings ingest via the public JSON API.

Three modes, selected by --mode or INGEST_MODE:

  windowed (default)  Crested geckos first_listed in WINDOW_HOURS
                      (default 168). New-ad enrichment. Never calls
                      mark_unseen_listings_inactive.
  catalog             Every animal MorphMarket currently lists, filtered
                      client-side to Crested Gecko. After a complete
                      walk, calls mark_unseen so stale live flags drop.
                      A truncated or aborted walk does not mark unseen.
  newest              The first pages of the newest-first list (MAX_PAGES,
                      default 3), meant to run every 30 minutes so a new
                      crested listing reaches the Market page's Live tape
                      and members' watchlists within the hour. Stops at
                      the first page with no new crested listing, reads
                      details only for new or re-priced listings, and
                      never marks anything unseen. Every newest run in a
                      UTC day shares one scrape_runs row (scrape_type
                      listings_newest), so a check every 30 minutes does
                      not bury the daily and weekly jobs on the status
                      pages.

After a run that wrote rows, the scraper asks the database to refresh the
market views and run the watchlist matcher (lib/after_scrape.py).

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
  INGEST_MODE           windowed | catalog | newest (overridden by --mode)
  WINDOW_HOURS          lookback for first_listed in windowed mode
  MAX_PAGES             list-page cap (windowed 250, catalog 800, newest 3)
  MIN_CATALOG_PAGES     fail a natural catalog end below this many pages (100)
  MIN_CATALOG_WRITES    refuse mark_unseen below this many upserts
  DETAIL_SLEEP_S        pause between detail fetches (default 0.15)
  PAGE_SLEEP_S          pause between list pages (default 0.5)
  SKIP_UNCHANGED        1 (default) skips the detail fetch for a known
                        live listing whose list price is unchanged and
                        whose details were read in the last
                        REFETCH_AFTER_DAYS; 0 fetches every detail
  REFETCH_AFTER_DAYS    re-read details at least this often even when the
                        price is unchanged (default 6, so every listing
                        still gets a price observation each week)
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
from typing import Any, Callable, Optional, TypeVar
from urllib.parse import unquote, urlencode, urlsplit

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

from lib.after_scrape import request_after_scrape
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
QUICK_RETRY_BACKOFF_S = (10,)
CATALOG_LIST_RETRY_BACKOFF_S = (15, 30, 60, 120)
CATALOG_DETAIL_RETRY_BACKOFF_S = (5, 15)

_FetchResult = TypeVar("_FetchResult")

_SELLER_ANCHOR_RE = re.compile(
    r'<a\b[^>]*\bhref=["\']/stores/(?P<slug>[^/"\']+)/?["\'][^>]*>'
    r"(?P<body>.*?)</a>",
    re.IGNORECASE | re.DOTALL,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")


class MorphMarketFetchError(RuntimeError):
    """A browser fetch failed without exposing proxy credentials."""

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


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

    def restart(self) -> None:
        """Relaunch Chromium on the current direct or proxy route."""
        self._restart_browser(use_proxy=self._using_proxy)

    def _restart_with_proxy(self) -> None:
        self._restart_browser(use_proxy=True)

    def _restart_browser(self, *, use_proxy: bool) -> None:
        if self._browser is not None:
            self._browser.close()
        self._browser = None
        self._context = None
        self._page = None
        self._launch(use_proxy=use_proxy)

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
        self.last_status = None
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
                    "MORPHMARKET_PROXY_URL. Decodo is not supported.",
                    retryable=False,
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
                    f"{self._safe_error(exc)}",
                    retryable=False,
                ) from exc
            return self._fetch_bytes(url)
        if response.status == 403:
            raise MorphMarketAccessDeniedError(
                "MorphMarket returned HTTP 403 through MORPHMARKET_PROXY_URL; "
                "verify that it is an active residential or mobile proxy",
                retryable=False,
            )
        if response.status != 200:
            route = " through MORPHMARKET_PROXY_URL" if self._using_proxy else ""
            raise MorphMarketFetchError(
                f"MorphMarket returned HTTP {response.status}{route}",
                retryable=response.status == 429 or 500 <= response.status < 600,
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


def fetch_with_retries(
    fetch: Callable[[], _FetchResult],
    *,
    what: str,
    fetcher: MorphMarketFetcher,
    backoffs: tuple[float, ...],
) -> _FetchResult:
    """Retry transient failures, restarting the browser before each retry."""
    waits = iter(backoffs)
    while True:
        try:
            return fetch()
        except MorphMarketAccessDeniedError:
            raise
        except MorphMarketFetchError as exc:
            if not exc.retryable:
                raise
            wait = next(waits, None)
            if wait is None:
                raise
            log(f"WARN {what}: {exc}; retrying in {wait}s")
            time.sleep(wait)
            try:
                fetcher.restart()
            except Exception:  # noqa: BLE001
                # Browser errors may contain proxy credentials; omit raw text.
                log(f"WARN {what}: browser restart failed; continuing retry")


# A run killed from outside (a CI timeout, a laptop going to sleep, a
# closed terminal) never reaches finalise_scrape_run and sits on
# 'running' forever, which reads as "a scrape is in progress" on the
# status page. Anything still 'running' after this long is closed out.
ABANDONED_AFTER_HOURS = 6


def close_abandoned_runs(supabase, scrape_type: str = "listings") -> int:
    """Mark stale 'running' scrape_runs rows of this type as failed."""
    cutoff = (
        dt.datetime.now(dt.timezone.utc)
        - dt.timedelta(hours=ABANDONED_AFTER_HOURS)
    ).isoformat()
    try:
        res = (
            supabase.table("scrape_runs")
            .update(
                {
                    "status": "failed",
                    "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "error_message": (
                        "abandoned: still marked running after "
                        f"{ABANDONED_AFTER_HOURS}h (the process was stopped "
                        "before it could record a result)"
                    ),
                }
            )
            .eq("scrape_type", scrape_type)
            .eq("status", "running")
            .lt("started_at", cutoff)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        log(f"WARN could not close abandoned runs: {exc}")
        return 0
    closed = len(res.data or [])
    if closed:
        log(f"closed {closed} abandoned '{scrape_type}' run(s)")
    return closed


# Skipping unchanged listings
#
# A full catalog walk fetches one detail page per listing, which is most
# of a run's time and most of its requests. When the list page already
# shows the same price we stored, and we read that listing's details
# recently, the detail fetch tells us nothing new. Those listings only
# get last_seen_at bumped, which is what keeps them from being swept as
# "came down" at the end of a complete walk.
#
# The list payload's shape is not documented. If a list item carries no
# usable price, the listing is fetched in full as before, so the worst
# case is today's behavior, never missed data.

LIST_PRICE_KEYS = ("price", "price_amount", "localized_price")
LIST_CURRENCY_KEYS = ("localized_price_currency", "price_currency", "currency")
TOUCH_BATCH_SIZE = 200


def _skip_unchanged_enabled() -> bool:
    return os.environ.get("SKIP_UNCHANGED", "1").strip().lower() not in (
        "0", "false", "no", "off", ""
    )


def _refetch_after_days() -> float:
    raw = os.environ.get("REFETCH_AFTER_DAYS", "6")
    return max(0.0, float(raw))


def _to_price(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        for key in ("amount", "value", "price"):
            if key in value:
                return _to_price(value[key])
        return None
    text = re.sub(r"[^0-9.]", "", str(value))
    if not text or text.count(".") > 1:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def list_item_price(item: dict[str, Any]) -> Optional[float]:
    for key in LIST_PRICE_KEYS:
        if key in item:
            price = _to_price(item.get(key))
            if price is not None:
                return price
    return None


def list_item_currency(item: dict[str, Any]) -> Optional[str]:
    for key in LIST_CURRENCY_KEYS:
        raw = item.get(key)
        if isinstance(raw, str) and raw.strip():
            cur = raw.strip()
            return "USD" if cur in ("$", "US$") else cur.upper()
    return None


def load_known_live(supabase) -> dict[str, dict[str, Any]]:
    """Live listings keyed by listing_id, with what the skip check needs."""
    known: dict[str, dict[str, Any]] = {}
    page_size = 1000
    offset = 0
    while True:
        chunk = (
            supabase.table("listings")
            .select("listing_id,price,currency,last_updated_at,is_active,sold_at")
            .eq("is_active", True)
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
        for row in chunk:
            lid = str(row.get("listing_id") or "").strip()
            if lid and not row.get("sold_at"):
                known[lid] = row
        if len(chunk) < page_size:
            break
        offset += page_size
    return known


def is_unchanged(
    item: dict[str, Any],
    stored: Optional[dict[str, Any]],
    *,
    now: dt.datetime,
    refetch_after: dt.timedelta,
) -> bool:
    """True when the list row proves nothing changed that a detail read would catch."""
    if not stored:
        return False
    if stored.get("is_active") is False or stored.get("sold_at"):
        return False
    list_price = list_item_price(item)
    stored_price = _to_price(stored.get("price"))
    if list_price is None or stored_price is None:
        return False
    if abs(list_price - stored_price) > 0.005:
        return False
    list_cur = list_item_currency(item)
    stored_cur = (stored.get("currency") or "USD").upper()
    if list_cur is not None and list_cur != stored_cur:
        return False
    read_at = _parse_iso(stored.get("last_updated_at"))
    if read_at is None or now - read_at >= refetch_after:
        return False
    return True


def touch_seen(supabase, listing_ids: list[str], seen_at: str) -> int:
    """Bump last_seen_at on listings the walk saw but did not re-read."""
    touched = 0
    for i in range(0, len(listing_ids), TOUCH_BATCH_SIZE):
        batch = listing_ids[i : i + TOUCH_BATCH_SIZE]
        try:
            supabase.table("listings").update({"last_seen_at": seen_at}).in_(
                "listing_id", batch
            ).execute()
        except Exception as exc:  # noqa: BLE001
            log(f"WARN: last_seen_at bump failed for {len(batch)} listings: {exc}")
            continue
        touched += len(batch)
        try:
            supabase.table("market_listings").update(
                {"last_seen_at": seen_at}
            ).in_("id", [f"mm_{lid}" for lid in batch]).execute()
        except Exception as exc:  # noqa: BLE001
            log(f"WARN: market_listings last_seen_at bump failed: {exc}")
    return touched


# The newest check
#
# Every 30 minutes the newest check reads the first page or two of the
# newest-first list, so new crested listings reach the Market page and
# members' watchlists soon after they go up. It looks up only the listings
# on those pages, reads details only for new or re-priced ones, and leaves
# "seen" bookkeeping and the came-down sweep to the catalog walk.

NEWEST_SCRAPE_TYPE = "listings_newest"


def load_known_for(supabase, listing_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Stored rows for just these listings, live or not."""
    known: dict[str, dict[str, Any]] = {}
    ids = [i for i in dict.fromkeys(listing_ids) if i]
    for start in range(0, len(ids), TOUCH_BATCH_SIZE):
        batch = ids[start : start + TOUCH_BATCH_SIZE]
        rows = (
            supabase.table("listings")
            .select("listing_id,price,currency,last_updated_at,is_active,sold_at")
            .in_("listing_id", batch)
            .execute()
            .data
            or []
        )
        for row in rows:
            lid = str(row.get("listing_id") or "").strip()
            if lid:
                known[lid] = row
    return known


def start_newest_run(supabase) -> tuple[int, dict[str, int]]:
    """Open today's listings_newest scrape_runs row, or reuse it.

    The status pages read the latest few hundred scrape_runs rows, and a
    check every 30 minutes would add 48 a day. So every newest run in a
    UTC day shares one row: its counts are the day's totals and its status
    is the latest run's. Returns the row id and the counts already on it.
    """
    day_start = dt.datetime.now(dt.timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    rows = (
        supabase.table("scrape_runs")
        .select("id,records_attempted,records_succeeded,records_failed")
        .eq("scrape_type", NEWEST_SCRAPE_TYPE)
        .gte("started_at", day_start.isoformat())
        .order("started_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if rows:
        row = rows[0]
        run_id = int(row["id"])
        supabase.table("scrape_runs").update(
            {"status": "running", "finished_at": None, "error_message": None}
        ).eq("id", run_id).execute()
        log(f"newest check: adding to today's scrape_runs row id={run_id}")
        return run_id, {
            "attempted": int(row.get("records_attempted") or 0),
            "succeeded": int(row.get("records_succeeded") or 0),
            "failed": int(row.get("records_failed") or 0),
        }
    created = (
        supabase.table("scrape_runs")
        .insert(
            {
                "scrape_type": NEWEST_SCRAPE_TYPE,
                "status": "running",
                "triggered_by": os.environ.get("TRIGGERED_BY", "manual"),
            }
        )
        .execute()
    )
    run_id = int(created.data[0]["id"])
    log(f"newest check: opened today's scrape_runs row id={run_id}")
    return run_id, {"attempted": 0, "succeeded": 0, "failed": 0}


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
        choices=("windowed", "catalog", "newest"),
        help=(
            "windowed = 7-day first_listed pulse; catalog = full live "
            "recrawl; newest = first pages only, for a 30-minute check"
        ),
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
    if text in ("newest", "latest", "new"):
        return "newest"
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
    page: int, fetcher: MorphMarketFetcher,
    backoffs: tuple[float, ...] = QUICK_RETRY_BACKOFF_S,
) -> dict[str, Any]:
    query = urlencode(
        {
            "ordering": "-first_posted",
            "page_size": PAGE_SIZE,
            "page": page,
        }
    )
    return fetch_with_retries(
        lambda: fetcher.fetch_json(f"{LIST_URL}?{query}"),
        what=f"list page {page}", fetcher=fetcher, backoffs=backoffs,
    )


def fetch_detail(
    listing_id: str, fetcher: MorphMarketFetcher,
    backoffs: tuple[float, ...] = QUICK_RETRY_BACKOFF_S,
) -> dict[str, Any]:
    return fetch_with_retries(
        lambda: fetcher.fetch_json(DETAIL_URL.format(id=listing_id)),
        what=f"detail {listing_id}", fetcher=fetcher, backoffs=backoffs,
    )


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


def catalog_ended_too_early(
    mode: str, saw_natural_end: bool, pages_read: int, min_pages: int
) -> bool:
    return mode == "catalog" and saw_natural_end and pages_read < min_pages


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
    # newest-first pages to cover WINDOW_HOURS; newest reads a page or two.
    default_pages = {"catalog": "800", "newest": "3"}.get(mode, "250")
    if os.environ.get("MAX_PAGES") is None:
        os.environ["MAX_PAGES"] = default_pages
    max_pages = _max_pages()
    min_pages = min(int(os.environ.get("MIN_CATALOG_PAGES", "100")), max_pages)
    list_backoffs = (
        CATALOG_LIST_RETRY_BACKOFF_S if mode == "catalog" else QUICK_RETRY_BACKOFF_S
    )
    detail_backoffs = (
        CATALOG_DETAIL_RETRY_BACKOFF_S if mode == "catalog" else QUICK_RETRY_BACKOFF_S
    )
    sleep_s = _detail_sleep()
    page_sleep_s = _page_sleep()
    min_writes = _min_catalog_writes()
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=window_hours)
    cutoff_date = cutoff.date()

    supabase = get_supabase()
    if mode == "newest":
        run_id, before = start_newest_run(supabase)
    else:
        close_abandoned_runs(supabase)
        run_id = start_scrape_run(supabase)
        before = {"attempted": 0, "succeeded": 0, "failed": 0}
    attempted = 0
    succeeded = 0
    failed = 0
    consecutive_empty = 0
    consecutive_fetch_failures = 0
    aborted = False
    walk_incomplete = False
    saw_natural_end = False
    hit_page_cap = False
    pages_read = 0
    fetcher: Optional[MorphMarketFetcher] = None

    skip_unchanged = _skip_unchanged_enabled()
    refetch_after = dt.timedelta(days=_refetch_after_days())
    known_live: dict[str, dict[str, Any]] = {}
    # The newest check looks up each page's listings as it goes instead.
    if skip_unchanged and mode != "newest":
        try:
            known_live = load_known_live(supabase)
            log(
                f"skip-unchanged on: {len(known_live)} live listings loaded, "
                f"details re-read after {refetch_after.days} days"
            )
        except Exception as exc:  # noqa: BLE001
            log(f"WARN: could not load known listings, fetching all: {exc}")
            known_live = {}
    skipped = 0
    list_prices_seen = 0
    logged_item_keys = False

    if mode == "catalog":
        log(
            f"API catalog recrawl: MAX_PAGES={max_pages} "
            f"MIN_CATALOG_WRITES={min_writes}"
        )
    elif mode == "newest":
        log(
            f"API newest check: up to {max_pages} pages, stopping at the "
            "first page with no new crested listing"
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
                payload = fetch_list_page(page, fetcher, backoffs=list_backoffs)
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
            pages_read = page

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

            if not logged_item_keys and isinstance(results[0], dict):
                # One line per run that shows what list rows carry, so the
                # skip check can be tuned from a real log.
                log(f"list item keys: {sorted(results[0].keys())}")
                logged_item_keys = True

            in_window_on_page = 0
            new_on_page = 0
            if mode == "newest":
                page_ids = [
                    str(it.get("key") or "").strip()
                    for it in results
                    if isinstance(it, dict) and is_crested(it)
                ]
                try:
                    known_live = load_known_for(supabase, page_ids)
                except Exception as exc:  # noqa: BLE001
                    log(f"WARN: could not look up page {page} listings, reading all: {exc}")
                    known_live = {}
                new_on_page = sum(
                    1 for lid in page_ids if lid and lid not in known_live
                )
            page_rows: list[dict[str, Any]] = []
            page_unchanged: list[str] = []
            walk_now = dt.datetime.now(dt.timezone.utc)
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
                if list_item_price(item) is not None:
                    list_prices_seen += 1
                if skip_unchanged and is_unchanged(
                    item,
                    known_live.get(listing_id),
                    now=walk_now,
                    refetch_after=refetch_after,
                ):
                    page_unchanged.append(listing_id)
                    continue
                try:
                    detail = fetch_detail(listing_id, fetcher, backoffs=detail_backoffs)
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

            if page_unchanged and mode == "newest":
                # The catalog walk keeps last_seen_at; this check only
                # reads what is new or re-priced.
                skipped += len(page_unchanged)
                log(f"page {page}: {len(page_unchanged)} already stored and unchanged")
            elif page_unchanged:
                touched = touch_seen(supabase, page_unchanged, walk_now.isoformat())
                skipped += touched
                # A confirmed sighting counts toward the catalog write floor,
                # otherwise a quiet day could never run the came-down sweep.
                succeeded += touched
                failed += len(page_unchanged) - touched
                if mode == "catalog" and touched < len(page_unchanged):
                    walk_incomplete = True
                consecutive_empty = 0
                log(f"page {page}: {touched} unchanged, skipped detail read")

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
                label = {
                    "catalog": "crested",
                    "newest": "new or re-priced crested",
                }.get(mode, "crested in window")
                log(f"page {page}: {len(page_rows)} {label}, wrote {wrote}")
            else:
                label = {
                    "catalog": "crested",
                    "newest": "new or re-priced crested",
                }.get(mode, "in-window crested")
                log(f"page {page}: no {label} listings")

            if mode == "newest" and new_on_page == 0:
                saw_natural_end = True
                log(f"stopping: no new crested listings on page {page}")
                break

            if page >= max_pages:
                if has_next:
                    hit_page_cap = True
                    if mode == "newest":
                        log(
                            f"still finding new listings at page {max_pages}; "
                            "the next catalog walk reads the rest"
                        )
                    else:
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

        short_walk_error = None
        if catalog_ended_too_early(mode, saw_natural_end, pages_read, min_pages):
            short_walk_error = (
                f"catalog ended too early after {pages_read} pages "
                f"(minimum {min_pages}); check that MORPHMARKET_PROXY_URL exits in the US"
            )
            log(f"ERROR: {short_walk_error}")
            walk_incomplete = True

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

        status = "failed" if short_walk_error else ("success" if failed == 0 else "partial")
        finalise_scrape_run(
            supabase,
            run_id,
            status=status,
            attempted=before["attempted"] + attempted,
            succeeded=before["succeeded"] + succeeded,
            failed=before["failed"] + failed,
            error_message=short_walk_error,
        )
        # The newest check counts only rows it wrote; a catalog or windowed
        # run also counts confirmed sightings, which matter to the
        # came-down sweep and the day's market numbers.
        if succeeded > 0:
            triggered_by = os.environ.get("TRIGGERED_BY", "manual")
            request_after_scrape(supabase, f"{mode}:{triggered_by}"[:80])
        if skip_unchanged and attempted and list_prices_seen == 0:
            log(
                "skip-unchanged had no effect: list rows carry no price, so "
                "every listing was read in full"
            )
        log(
            f"done mode={mode} status={status} attempted={attempted} "
            f"succeeded={succeeded} failed={failed} skipped_unchanged={skipped} "
            f"complete={complete}"
        )
        return 1 if short_walk_error else 0
    except Exception as exc:  # noqa: BLE001
        aborted = True
        log(f"FATAL: {exc}")
        traceback.print_exc()
        finalise_scrape_run(
            supabase,
            run_id,
            status="failed",
            attempted=before["attempted"] + attempted,
            succeeded=before["succeeded"] + succeeded,
            failed=before["failed"] + failed + 1,
            error_message=str(exc),
        )
        return 1
    finally:
        if fetcher is not None:
            fetcher.close()


if __name__ == "__main__":
    sys.exit(main())
