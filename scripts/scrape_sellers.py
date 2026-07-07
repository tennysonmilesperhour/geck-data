"""
Weekly per-seller scrape. Walks the subset of MorphMarket stores that
are linked from at least one of our active listings and that we haven't
refreshed in the last 7 days, then upserts a row per seller into
public.sellers.

Env vars consumed: DECODO_AUTH, SUPABASE_URL, SUPABASE_SERVICE_KEY,
TRIGGERED_BY, MAX_SELLERS (optional cap for smoke tests).

Concurrency: 2 parallel workers with a 2s per-worker delay. The Decodo
wrapper enforces a global rate ceiling, so we stay well under the plan's
10 req/s cap.
"""
from __future__ import annotations

import datetime as dt
import html as html_lib
import os
import re
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, NamedTuple, Optional

from lib.budget import BudgetExceededError, DecodoBudget
from lib.decodo_client import DecodoClient
from lib.supabase_client import get_supabase

WORKER_COUNT = 2

# If this many fetches in a row come back as hard failures (proxy quota
# exhausted, provider outage), abort the whole run as 'failed' instead of
# burning credits on the rest of the queue. Parse skips and write
# failures do not count; only fetch-layer exceptions do.
CONSECUTIVE_FETCH_FAILURE_LIMIT = 5
PER_WORKER_DELAY_SECONDS = 2.0

# Same status codes the details scraper deactivates on. If a store URL
# returns 404 / 410 we don't update the sellers row; we just skip and
# let the next pass retry once the listings that point at it have
# rotated out of is_active=true.
SKIP_STATUSES = frozenset({404, 410})

# Same browser_actions recipe the listings grid uses. The store page is
# similarly React-driven and needs hydration time before the stats
# blocks paint into the DOM.
SELLER_BROWSER_ACTIONS = [
    {"type": "wait", "wait_time_s": 5},
    {"type": "scroll_to_bottom", "timeout_s": 10},
    {"type": "wait", "wait_time_s": 3},
]


class FetchResult(NamedTuple):
    action: str  # "upsert" | "skip"
    seller_slug: str
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
                "scrape_type": "sellers",
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


def fetch_seller(decodo: DecodoClient, slug: str) -> FetchResult:
    """Fetch one store page through Decodo with the listings recipe."""
    import time

    time.sleep(PER_WORKER_DELAY_SECONDS)
    url = f"https://www.morphmarket.com/stores/{slug}"
    log(f"GET {url}")
    resp = decodo.fetch(
        url,
        headless="html",
        proxy_pool="premium",
        browser_actions=SELLER_BROWSER_ACTIONS,
        timeout_seconds=180,
    )
    if resp.status_code in SKIP_STATUSES:
        log(f"seller {slug} status={resp.status_code}; skipping")
        return FetchResult(action="skip", seller_slug=slug, reason=f"status_{resp.status_code}")
    if resp.status_code != 200:
        log(f"WARN seller {slug} status={resp.status_code}")
        return FetchResult(action="skip", seller_slug=slug, reason=f"status_{resp.status_code}")

    parsed = parse_seller_html(resp.html, seller_slug=slug)
    if not parsed:
        return FetchResult(action="skip", seller_slug=slug, reason="parse_failed")
    return FetchResult(action="upsert", seller_slug=slug, row=parsed)


# ---------------------------------------------------------------------------
# Parsing helpers — adapted from the archive's parse_sellers.py.
# ---------------------------------------------------------------------------

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.DOTALL | re.IGNORECASE)
_META_DESC_RE = re.compile(
    r'<meta\s+name="description"\s+content="([^"]+)"',
    re.IGNORECASE,
)
_MEMBERSHIP_RE = re.compile(
    r'class="[^"]*membershipInfoText[^"]*"[^>]*>([^<]+)<',
    re.IGNORECASE,
)
# Each sellerStatsItem block contains a number plus a label.
_STATS_BLOCK_RE = re.compile(
    r'class="[^"]*sellerStatsItem[^"]*"[^>]*>(.*?)</div>\s*</div>',
    re.DOTALL | re.IGNORECASE,
)
_STATS_NUMBER_RE = re.compile(r">\s*([\d,.kK]+)\s*<")
_STATS_LABEL_RE = re.compile(r">\s*([A-Za-z][A-Za-z\s]+)\s*<")
_AVATAR_RE = re.compile(
    r'<meta\s+property="og:image"\s+content="([^"]+)"',
    re.IGNORECASE,
)
# Best-effort owner/location parse:
#   "{Store} on MorphMarket is owned by {Owner} and located in {City, State}."
_DESC_OWNER_LOC_RE = re.compile(
    r"is owned by (?P<owner>.+?) and located in (?P<location>[^.]+)\.?",
    re.IGNORECASE,
)


def _normalise_int(raw: str) -> Optional[int]:
    """Turn '1,234', '5.2k', '32K' into an int. Returns None on failure."""
    if not raw:
        return None
    text = raw.strip().replace(",", "")
    multiplier = 1
    if text.lower().endswith("k"):
        multiplier = 1000
        text = text[:-1]
    try:
        return int(float(text) * multiplier)
    except (ValueError, TypeError):
        return None


def parse_seller_html(html: str, *, seller_slug: str) -> Optional[dict[str, Any]]:
    """Extract the bare-minimum seller fields from one store page."""
    if not html:
        return None

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    row: dict[str, Any] = {
        "seller_slug": seller_slug,
        "last_updated_at": now_iso,
    }

    # store_name: prefer <title> with " - MorphMarket" stripped.
    title_match = _TITLE_RE.search(html)
    if title_match:
        title = html_lib.unescape(title_match.group(1).strip())
        title = re.sub(r"\s*[-|]\s*MorphMarket.*$", "", title, flags=re.IGNORECASE)
        if title:
            row["store_name"] = title.strip() or None

    # owner_name + location_raw via meta description.
    meta_match = _META_DESC_RE.search(html)
    if meta_match:
        desc = html_lib.unescape(meta_match.group(1))
        m = _DESC_OWNER_LOC_RE.search(desc)
        if m:
            row["owner_name"] = m.group("owner").strip() or None
            row["location_raw"] = m.group("location").strip() or None

    # member_since: e.g. "Basic Member since 2025"
    mem_match = _MEMBERSHIP_RE.search(html)
    if mem_match:
        row["member_since"] = html_lib.unescape(mem_match.group(1).strip())

    # listings_count: walk every stats block and pick the one labelled
    # "Listings" (or "Listing"). Other labels in the same block include
    # Followers / Noticed / Liked but we only need listings for now.
    for block in _STATS_BLOCK_RE.findall(html):
        label_match = _STATS_LABEL_RE.search(block)
        if not label_match:
            continue
        label = label_match.group(1).strip().lower()
        if label in {"listings", "listing"}:
            num_match = _STATS_NUMBER_RE.search(block)
            if num_match:
                count = _normalise_int(num_match.group(1))
                if count is not None:
                    row["listings_count"] = count
            break

    # avatar_url from og:image.
    avatar_match = _AVATAR_RE.search(html)
    if avatar_match:
        row["avatar_url"] = avatar_match.group(1).strip()

    # If we didn't pull at least the store name or listings_count, the
    # parse is too thin to bother writing.
    if not row.get("store_name") and row.get("listings_count") is None:
        return None
    return row


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


def main() -> int:
    max_sellers_env = os.environ.get("MAX_SELLERS")
    max_sellers = int(max_sellers_env) if max_sellers_env else None

    supabase = get_supabase()
    budget = DecodoBudget(supabase)
    decodo = DecodoClient(budget=budget)

    run_id = start_scrape_run(supabase)
    attempted = 0
    succeeded = 0
    failed = 0

    try:
        log("querying sellers_needing_scrape")
        view_data = (
            supabase.table("sellers_needing_scrape").select("seller_slug").execute().data
            or []
        )
        slugs = [r["seller_slug"] for r in view_data if r.get("seller_slug")]
        if max_sellers:
            slugs = slugs[:max_sellers]
        log(f"need to scrape {len(slugs)} sellers")

        if not slugs:
            finalise_scrape_run(
                supabase, run_id, status="success", attempted=0, succeeded=0, failed=0
            )
            return 0

        consecutive_fetch_failures = 0
        with ThreadPoolExecutor(max_workers=WORKER_COUNT) as pool:
            futures = {pool.submit(fetch_seller, decodo, slug): slug for slug in slugs}
            for future in as_completed(futures):
                slug = futures[future]
                attempted += 1
                try:
                    result = future.result()
                except BudgetExceededError:
                    # Monthly quota threshold hit; stop the whole run now.
                    pool.shutdown(wait=False, cancel_futures=True)
                    raise
                except Exception as exc:  # noqa: BLE001
                    log(f"ERROR seller {slug}: {exc}")
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

                if result.action == "upsert" and result.row:
                    try:
                        supabase.table("sellers").upsert(
                            result.row, on_conflict="seller_slug"
                        ).execute()
                        succeeded += 1
                    except Exception as exc:  # noqa: BLE001
                        log(f"WARN write failed for {slug}: {exc}")
                        failed += 1
                else:
                    failed += 1

                if attempted % 25 == 0:
                    log(
                        f"progress: attempted={attempted} succeeded={succeeded} "
                        f"failed={failed}"
                    )

        log(
            f"final tally: attempted={attempted} succeeded={succeeded} failed={failed}"
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
