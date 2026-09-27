"""Fill in a year of market history from a sample of old MorphMarket listings.

Tracking started in May 2026, but MorphMarket hands out listing ids in
order, so every listing posted in the past year lies in one id range.
Reading every Nth id in that range (newest first) gives a fair sample of
what was posted each month, including geckos that have since sold. One row
per sampled id goes into geck_data.listing_backfill, whatever the species,
so a rerun skips ids it has already read and picks up where it stopped.
The live catalog tables are never touched.

Usage (from scripts/):
  python backfill_history.py --probe        read 12 spread-out ids, write nothing
  python backfill_history.py                read up to --max-ids new ids
  python backfill_history.py --all          keep going until the year is done

Options:
  --every N      sampling step (default 25: one id in 25)
  --months M     how far back to go (default 12)
  --max-ids K    stop after reading K new ids this run (default 4000)
  --from-id ID   override the oldest id (otherwise estimated from known dates)

Env: SUPABASE_URL / SUPABASE_SERVICE_KEY, optional MORPHMARKET_PROXY_URL,
BACKFILL_SLEEP_S (pause between reads, default 0.3).
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import statistics
import sys
import time
from typing import Any, Iterable, Optional

from lib.supabase_client import get_supabase
from scrape_listings import log
from scrape_listings_api import (
    MIN_DETAIL_SLEEP_S,
    MorphMarketAccessDeniedError,
    MorphMarketFetcher,
    MorphMarketFetchError,
    _parse_iso,
    detail_to_listing_row,
    fetch_detail,
    fetch_list_page,
    is_crested,
)

WRITE_BATCH = 100
CONSECUTIVE_ERROR_LIMIT = 10
GONE_STATUSES = {404, 410}


def sampled_ids(newest: int, oldest: int, every: int) -> list[int]:
    """Every id divisible by `every` from newest down to oldest, inclusive."""
    if every < 1 or newest < oldest:
        return []
    start = newest - (newest % every)
    return list(range(start, oldest - 1, -every))


def estimate_oldest_id(
    pairs: Iterable[tuple[int, dt.datetime]],
    target: dt.datetime,
    window_days: int = 20,
) -> Optional[int]:
    """Median id of listings posted within window_days of target.

    Ids rise with posting date, so the ids posted around the target date
    mark where the walk should stop. Returns None if fewer than 5 known
    listings fall in the window.
    """
    lo = target - dt.timedelta(days=window_days)
    hi = target + dt.timedelta(days=window_days)
    near = [nid for nid, at in pairs if lo <= at <= hi]
    if len(near) < 5:
        return None
    return int(statistics.median(near))


def backfill_row(
    listing_id: int,
    *,
    every: int,
    status: int,
    detail: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "listing_id": str(listing_id),
        "http_status": status,
        "sample_every": every,
    }
    if detail is None:
        return row
    crested = is_crested(detail)
    listed = _parse_iso(detail.get("first_listed"))
    state = str(detail.get("state") or "").strip() or None
    row.update(
        {
            "is_crested": crested,
            "first_listed_at": listed.isoformat() if listed else None,
            "state": state,
            "is_sold": bool(detail.get("is_sold"))
            or ("sold" in (state or "").lower()),
        }
    )
    if crested:
        # Reuse the catalog scraper's parsing so prices, traits, sex and age
        # mean exactly what they mean everywhere else on the site.
        full = detail_to_listing_row(detail, listed or dt.datetime.now(dt.timezone.utc))
        row.update(
            {
                "name": full.get("name"),
                "price": full.get("price"),
                "currency": full.get("currency"),
                "trait_array": full.get("trait_array"),
                "sex": full.get("sex"),
                "maturity": full.get("maturity"),
            }
        )
    return row


def known_pairs(supabase) -> list[tuple[int, dt.datetime]]:
    """(id, posting date) for every listing whose posting date we know."""
    pairs: list[tuple[int, dt.datetime]] = []
    for table, id_col, at_col in (
        ("market_listings", "id", "first_listed_at"),
        ("listing_backfill", "listing_id", "first_listed_at"),
    ):
        offset = 0
        while True:
            chunk = (
                supabase.table(table)
                .select(f"{id_col},{at_col}")
                .not_.is_(at_col, "null")
                .range(offset, offset + 999)
                .execute()
                .data
                or []
            )
            for r in chunk:
                raw = str(r.get(id_col) or "").removeprefix("mm_")
                at = _parse_iso(r.get(at_col))
                if raw.isdigit() and at:
                    pairs.append((int(raw), at))
            if len(chunk) < 1000:
                break
            offset += 1000
    return pairs


def already_read(supabase, oldest: int, newest: int) -> set[int]:
    done: set[int] = set()
    offset = 0
    while True:
        chunk = (
            supabase.table("listing_backfill")
            .select("nid")
            .gte("nid", oldest)
            .lte("nid", newest)
            .range(offset, offset + 999)
            .execute()
            .data
            or []
        )
        done.update(int(r["nid"]) for r in chunk if r.get("nid") is not None)
        if len(chunk) < 1000:
            break
        offset += 1000
    return done


def newest_id(fetcher: MorphMarketFetcher) -> int:
    payload = fetch_list_page(1, fetcher)
    ids = [
        int(str(i.get("key")))
        for i in payload.get("results") or []
        if str(i.get("key") or "").isdigit()
    ]
    if not ids:
        raise RuntimeError("list page 1 had no numeric listing ids")
    return max(ids)


def read_one(
    fetcher: MorphMarketFetcher, listing_id: int, every: int
) -> Optional[dict[str, Any]]:
    """A backfill row, or None for a transient error worth retrying later."""
    try:
        detail = fetch_detail(str(listing_id), fetcher)
    except MorphMarketAccessDeniedError:
        raise
    except MorphMarketFetchError as exc:
        status = fetcher.last_status
        if status in GONE_STATUSES:
            return backfill_row(listing_id, every=every, status=status)
        log(f"WARN {listing_id}: {exc}")
        return None
    return backfill_row(listing_id, every=every, status=200, detail=detail)


def write(supabase, rows: list[dict[str, Any]]) -> None:
    if rows:
        supabase.table("listing_backfill").upsert(
            rows, on_conflict="listing_id"
        ).execute()


def probe(fetcher: MorphMarketFetcher, newest: int, oldest: int) -> int:
    """Read 12 ids spread across the range and report what came back."""
    span = max(newest - oldest, 1)
    ok = 0
    for i in range(12):
        lid = newest - (span * i) // 11
        row = read_one(fetcher, lid, 1)
        time.sleep(MIN_DETAIL_SLEEP_S)
        if row is None:
            print(f"{lid}: error (see warning above)", flush=True)
            continue
        print(
            f"{lid}: http {row['http_status']} crested={row.get('is_crested')} "
            f"listed={row.get('first_listed_at')} state={row.get('state')} "
            f"price={row.get('price')}",
            flush=True,
        )
        if row["http_status"] == 200 and row.get("first_listed_at"):
            ok += 1
    print(
        f"{ok} of 12 old ids returned a posting date. "
        + ("Backfill will work." if ok else "Backfill cannot work this way."),
        flush=True,
    )
    return 0 if ok else 1


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--every", type=int, default=25)
    ap.add_argument("--months", type=int, default=12)
    ap.add_argument("--max-ids", type=int, default=4000)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--from-id", type=int, default=None)
    ap.add_argument("--probe", action="store_true")
    args = ap.parse_args(argv)
    sleep_s = max(MIN_DETAIL_SLEEP_S, float(os.environ.get("BACKFILL_SLEEP_S", "0.3")))

    supabase = get_supabase()
    now = dt.datetime.now(dt.timezone.utc)
    first_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month = first_of_month.month - args.months
    year = first_of_month.year + (month - 1) // 12
    target = first_of_month.replace(year=year, month=(month - 1) % 12 + 1)

    with MorphMarketFetcher() as fetcher:
        newest = newest_id(fetcher)
        oldest = args.from_id or estimate_oldest_id(known_pairs(supabase), target)
        if oldest is None:
            log(
                "not enough known posting dates near "
                f"{target.date()} to find where to stop; pass --from-id"
            )
            return 1
        # Start a little earlier so the oldest month is fully covered.
        oldest = int(oldest - (newest - oldest) * 0.02)
        log(f"id range {oldest} to {newest} (back to about {target.date()}), one in {args.every}")

        if args.probe:
            return probe(fetcher, newest, oldest)

        todo = sampled_ids(newest, oldest, args.every)
        done = already_read(supabase, oldest, newest)
        todo = [i for i in todo if i not in done]
        limit = len(todo) if args.all else min(args.max_ids, len(todo))
        log(f"{len(done)} ids already read, {len(todo)} left, reading {limit} this run")
        if not todo:
            log("backfill complete")
            return 0

        batch: list[dict[str, Any]] = []
        read = crested = gone = errors = streak = 0
        oldest_date: Optional[str] = None
        for lid in todo[:limit]:
            row = read_one(fetcher, lid, args.every)
            time.sleep(sleep_s)
            if row is None:
                errors += 1
                streak += 1
                if streak >= CONSECUTIVE_ERROR_LIMIT:
                    log(f"stopping: {streak} errors in a row")
                    break
                continue
            streak = 0
            read += 1
            crested += 1 if row.get("is_crested") else 0
            gone += 1 if row["http_status"] in GONE_STATUSES else 0
            oldest_date = row.get("first_listed_at") or oldest_date
            batch.append(row)
            if len(batch) >= WRITE_BATCH:
                write(supabase, batch)
                batch = []
            if read % 500 == 0:
                log(f"read {read}: {crested} crested, {gone} gone, back to {str(oldest_date)[:10]}")
        write(supabase, batch)
        log(
            f"done: read {read}, crested {crested}, gone {gone}, errors {errors}, "
            f"back to {str(oldest_date)[:10]}, {len(todo) - read} ids left"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
