"""
One-shot backfill: copy public.listings into the canonical schema
(public.market_listings + public.market_sellers + public.price_history).

Why this exists: the public web app and the Geck Inspect companion app read
from market_listings. The Decodo scraper has historically only written to
listings, so ~4,700 historical rows are invisible to clients. This script
closes that gap once. After it runs, every public route shows the full
dataset.

Safe to re-run: every write is an UPSERT keyed on a natural id, so re-runs
just refresh fields without duplicating rows. price_history is insert-only
but uses a (listing_id, observed_at) dedupe filter to avoid re-observing
the same scrape at the same timestamp.

Usage:
  # plan only — no writes
  python scripts/backfill_market_listings.py --dry-run

  # write the first 50 rows so you can eyeball the result before committing
  python scripts/backfill_market_listings.py --limit 50

  # full run
  python scripts/backfill_market_listings.py

  # only rows scraped after a date (smaller delta)
  python scripts/backfill_market_listings.py --since 2026-05-01

  # skip the price_history insert (run only the listings + sellers upsert)
  python scripts/backfill_market_listings.py --skip-price-history
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from lib.canonical import (  # noqa: E402
    CanonicalWriteStats,
    upsert_canonical_from_listings,
)
from lib.supabase_client import get_supabase  # noqa: E402


PAGE_SIZE = 500


def configure_logging() -> logging.Logger:
    logger = logging.getLogger("backfill_market_listings")
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("[%(asctime)s] %(message)s", "%Y-%m-%dT%H:%M:%S"))
    logger.addHandler(handler)
    return logger


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Backfill public.listings into the canonical market_* tables."
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview the plan; no writes.",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after N source rows (smoke testing).",
    )
    p.add_argument(
        "--since",
        type=str,
        default=None,
        help="Only consider listings whose last_seen_at >= this ISO date.",
    )
    p.add_argument(
        "--skip-price-history",
        action="store_true",
        help="Skip the price_history insert.",
    )
    return p.parse_args()


def fetch_listings_page(
    supabase,
    *,
    offset: int,
    limit: int,
    since_iso: Optional[str],
) -> list[dict[str, Any]]:
    """Read one page of listings ordered by listing_id for stable pagination."""
    query = supabase.table("listings").select(
        "listing_id,name,price,currency,seller_name,sex,weight,weight_grams,"
        "maturity,birth_date,origin,traits,trait_array,trait_count,"
        "description,primary_image_url,all_image_urls,image_count,"
        "listing_url,availability,shipping_label,shipping_rate,"
        "shipping_currency,payment_method,sku,is_active,"
        "first_seen_at,last_seen_at,last_updated_at"
    ).order("listing_id").range(offset, offset + limit - 1)
    if since_iso:
        query = query.gte("last_seen_at", since_iso)
    result = query.execute()
    return result.data or []


def open_run(supabase, *, dry_run: bool) -> Optional[int]:
    if dry_run:
        return None
    triggered_by = os.environ.get("TRIGGERED_BY", "local_backfill")
    row = (
        supabase.table("scrape_runs")
        .insert(
            {
                "scrape_type": "canonical_backfill",
                "status": "running",
                "triggered_by": triggered_by,
            }
        )
        .execute()
    )
    return int(row.data[0]["id"])


def close_run(
    supabase,
    run_id: Optional[int],
    *,
    status: str,
    attempted: int,
    succeeded: int,
    failed: int,
    error_message: Optional[str] = None,
) -> None:
    if run_id is None:
        return
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


def main() -> int:
    args = parse_args()
    logger = configure_logging()

    if args.dry_run:
        logger.info("DRY RUN: no writes will happen")

    supabase = get_supabase()

    # How big is the source?
    total_query = supabase.table("listings").select("listing_id", count="exact", head=True)
    if args.since:
        total_query = total_query.gte("last_seen_at", args.since)
    total = total_query.execute().count or 0
    if args.limit is not None:
        plan_total = min(total, args.limit)
    else:
        plan_total = total
    logger.info(
        f"plan: read {plan_total} listings"
        + (f" since {args.since}" if args.since else "")
        + (f" (capped by --limit {args.limit})" if args.limit else "")
    )

    run_id = open_run(supabase, dry_run=args.dry_run)
    if run_id is not None:
        logger.info(f"opened scrape_runs id={run_id} scrape_type=canonical_backfill")

    cumulative = CanonicalWriteStats()
    attempted = 0
    final_status = "success"
    error_message: Optional[str] = None

    try:
        offset = 0
        while True:
            this_page = PAGE_SIZE
            if args.limit is not None:
                remaining = args.limit - attempted
                if remaining <= 0:
                    break
                this_page = min(this_page, remaining)

            rows = fetch_listings_page(
                supabase, offset=offset, limit=this_page, since_iso=args.since
            )
            if not rows:
                break

            attempted += len(rows)

            if args.dry_run:
                # Show shape of the first few translations so the user can
                # eyeball the mapping.
                if offset == 0:
                    from lib.canonical import transform_listing
                    for row in rows[:3]:
                        translated = transform_listing(row)
                        logger.info(f"  preview: listing_id={row.get('listing_id')}")
                        logger.info(f"    → market_listings.id={translated['id']}")
                        logger.info(f"    → title={translated['title']!r}")
                        logger.info(f"    → price={translated['price']!r}")
                        logger.info(f"    → seller_id={translated['seller_id']!r}")
                        logger.info(f"    → is_sold={translated['is_sold']}")
            else:
                stats = upsert_canonical_from_listings(
                    supabase,
                    rows,
                    write_price_history=not args.skip_price_history,
                    logger=logger,
                )
                cumulative.listings_upserted += stats.listings_upserted
                cumulative.listings_failed += stats.listings_failed
                cumulative.sellers_upserted += stats.sellers_upserted
                cumulative.sellers_failed += stats.sellers_failed
                cumulative.price_history_inserted += stats.price_history_inserted
                cumulative.price_history_failed += stats.price_history_failed
                cumulative.skipped_no_id += stats.skipped_no_id
                logger.info(
                    f"  page offset={offset} size={len(rows)}: "
                    f"listings+={stats.listings_upserted} "
                    f"sellers+={stats.sellers_upserted} "
                    f"price_history+={stats.price_history_inserted}"
                )

            offset += len(rows)
            if len(rows) < this_page:
                break

        if cumulative.listings_failed and cumulative.listings_upserted:
            final_status = "partial"
        elif cumulative.listings_failed and not cumulative.listings_upserted:
            final_status = "failed"
            error_message = "all batches failed; check upstream errors above"
    except Exception as exc:
        final_status = "failed"
        error_message = f"{type(exc).__name__}: {exc}"
        logger.exception("FATAL")
    finally:
        close_run(
            supabase,
            run_id,
            status=final_status,
            attempted=attempted,
            succeeded=cumulative.listings_upserted,
            failed=cumulative.listings_failed,
            error_message=error_message,
        )

    logger.info(f"done. attempted={attempted}, status={final_status}")
    logger.info(f"summary: {cumulative.as_dict()}")
    return 0 if final_status in ("success", "partial") else 1


if __name__ == "__main__":
    sys.exit(main())
