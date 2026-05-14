"""
One-shot CSV to Supabase migration for the historical crested gecko data.

Loads ~/Desktop/geckscrape/crested_geckos_full.csv into the geck-data
Supabase project. Creates one scrape_runs row labeled 'csv_migration',
upserts every CSV row into public.listings (preserving the original
scraped_at as first_seen_at / last_updated_at / last_seen_at), and
appends one row per listing into public.listings_history with the
original CSV row stored in raw_snapshot.

Why this exists: the production scrape pipeline is forward-looking only.
Tennyson has ~5849 historical listings on disk that need to land in the
DB once. After this script runs, the daily / weekly scrape jobs take
over.

Safe to re-run: listings is UPSERT-keyed on listing_id. By default this
script refuses to re-append duplicate listings_history rows when a
previous successful csv_migration run already exists; pass --force to
override.

Usage:
  python scripts/migrate_csvs.py --dry-run --limit 5
  python scripts/migrate_csvs.py
  python scripts/migrate_csvs.py --csv /path/to/other.csv
  python scripts/migrate_csvs.py --force        # re-run after success
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Optional

# Allow `python scripts/migrate_csvs.py` from the repo root.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from lib.supabase_client import get_supabase  # noqa: E402
from transform_and_load import (  # noqa: E402
    chunked,
    coerce_float,
    coerce_int,
    normalise_listing_id,
    parse_weight_grams,
    split_traits,
)

DEFAULT_CSV = Path.home() / "Desktop" / "geckscrape" / "crested_geckos_full.csv"

# Supabase HTTP POST stays comfortable under a few hundred rows per call.
# 500 keeps the request body well under typical limits and makes progress
# logging useful.
UPSERT_BATCH_SIZE = 500
HISTORY_BATCH_SIZE = 500


def log(message: str) -> None:
    """Print with timestamp and flush so progress streams live."""
    ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    print(f"[{ts}] {message}", flush=True)


def parse_scraped_at(raw: Any) -> Optional[str]:
    """Convert a CSV scraped_at cell to an ISO 8601 UTC string.

    The CSVs were written by the local pipeline as naive ISO timestamps
    (e.g. '2026-05-09T04:11:57.171180'). Treat naive timestamps as UTC
    so first_seen_at is monotonic and never NULL when we have data.
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        # fromisoformat accepts either a naive timestamp or one with an
        # offset. We attach UTC to naive values explicitly.
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.isoformat()


def split_image_urls(raw: Any) -> list[str]:
    """Split the all_images CSV cell into a list of URLs.

    The exporter joined multiple image URLs with either pipes, commas,
    or whitespace depending on the row vintage. Be permissive.
    """
    if raw is None:
        return []
    text = str(raw).strip()
    if not text:
        return []
    # Try the explicit delimiters first.
    for sep in ("|", "\n"):
        if sep in text:
            return [p.strip() for p in text.split(sep) if p.strip()]
    # Comma-separated only counts when the comma is followed by a URL,
    # otherwise commas inside a single URL would split it incorrectly.
    if ", https://" in text or ",https://" in text:
        return [p.strip() for p in text.split(",") if p.strip().startswith("http")]
    return [text]


def is_active_from_availability(raw: Any) -> bool:
    """Map a schema.org availability string to a boolean is_active flag."""
    if raw is None:
        return True
    text = str(raw).strip().lower()
    if not text:
        return True
    # Anything that is not explicitly a sold/discontinued state stays
    # active. The CSV mostly contains 'https://schema.org/InStock'.
    inactive_markers = ("soldout", "outofstock", "discontinued")
    return not any(m in text for m in inactive_markers)


def transform_row(raw_row: dict[str, str]) -> Optional[dict[str, Any]]:
    """Convert a raw CSV row dict into a listings UPSERT payload.

    Returns None if the row has no listing_id (we never want blank PKs).
    """
    listing_id = normalise_listing_id(raw_row.get("listing_id"))
    if not listing_id:
        return None

    scraped_at_iso = parse_scraped_at(raw_row.get("scraped_at"))
    weight_raw = raw_row.get("weight")
    traits_raw = raw_row.get("traits")
    images = split_image_urls(raw_row.get("all_images"))

    payload: dict[str, Any] = {
        "listing_id": listing_id,
        "name": raw_row.get("name") or None,
        "price": coerce_float(raw_row.get("price")),
        "currency": raw_row.get("currency") or None,
        "seller_name": raw_row.get("seller_name") or None,
        "sex": raw_row.get("sex") or None,
        "weight": weight_raw or None,
        "weight_grams": parse_weight_grams(weight_raw),
        "maturity": raw_row.get("maturity") or None,
        "scientific_name": raw_row.get("scientific_name") or None,
        "birth_date": raw_row.get("birth_date") or None,
        "origin": raw_row.get("origin") or None,
        "pet_only": raw_row.get("pet_only") or None,
        "lineage": raw_row.get("lineage") or None,
        "traits": traits_raw or None,
        "trait_array": split_traits(traits_raw),
        "trait_count": coerce_int(raw_row.get("trait_count")),
        "category": raw_row.get("category") or None,
        "description": raw_row.get("description") or None,
        "primary_image_url": raw_row.get("primary_image") or None,
        "all_image_urls": images,
        "image_count": coerce_int(raw_row.get("image_count")) or len(images),
        "listing_url": raw_row.get("listing_url") or "",
        "availability": raw_row.get("availability") or None,
        "shipping_label": raw_row.get("shipping_label") or None,
        "shipping_rate": coerce_float(raw_row.get("shipping_rate")),
        "shipping_currency": raw_row.get("shipping_currency") or None,
        "payment_method": raw_row.get("payment_method") or None,
        "sku": raw_row.get("sku") or None,
        "is_active": is_active_from_availability(raw_row.get("availability")),
    }
    if scraped_at_iso:
        # Preserve the original observation time across all three columns
        # so first_seen_at is honest and the daily scrape will only bump
        # last_seen_at when it actually re-sees this listing.
        payload["first_seen_at"] = scraped_at_iso
        payload["last_updated_at"] = scraped_at_iso
        payload["last_seen_at"] = scraped_at_iso
    return payload


def history_row(
    listing_payload: dict[str, Any],
    raw_row: dict[str, str],
    run_id: int,
    scraped_at_iso: Optional[str],
) -> dict[str, Any]:
    """Build a listings_history row mirroring this CSV observation."""
    return {
        "listing_id": listing_payload["listing_id"],
        "scrape_run_id": run_id,
        "observed_at": scraped_at_iso
        or dt.datetime.now(dt.timezone.utc).isoformat(),
        "price": listing_payload.get("price"),
        "is_active": listing_payload.get("is_active", True),
        "raw_snapshot": {k: v for k, v in raw_row.items() if v not in (None, "")},
    }


def previous_csv_migration_succeeded(supabase) -> bool:
    """Return True if a prior csv_migration scrape_run finished as success."""
    result = (
        supabase.table("scrape_runs")
        .select("id,status")
        .eq("scrape_type", "csv_migration")
        .eq("status", "success")
        .limit(1)
        .execute()
    )
    return bool(result.data)


def open_run(supabase) -> int:
    triggered_by = os.environ.get("TRIGGERED_BY", "local_csv")
    row = (
        supabase.table("scrape_runs")
        .insert(
            {
                "scrape_type": "csv_migration",
                "status": "running",
                "triggered_by": triggered_by,
            }
        )
        .execute()
    )
    run_id = int(row.data[0]["id"])
    log(f"opened scrape_runs id={run_id} triggered_by={triggered_by}")
    return run_id


def close_run(
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
        f"closed scrape_runs id={run_id}: status={status} attempted={attempted} "
        f"succeeded={succeeded} failed={failed}"
    )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="One-shot CSV to Supabase migration for crested gecko listings."
    )
    p.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_CSV,
        help=f"Path to the CSV file. Default: {DEFAULT_CSV}",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after N rows (smoke testing).",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and transform rows but do not write to Supabase.",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Re-run even if a previous csv_migration run already succeeded.",
    )
    p.add_argument(
        "--skip-history",
        action="store_true",
        help="Skip writing listings_history rows. Use for upsert-only re-runs.",
    )
    return p.parse_args()


def iter_csv_rows(path: Path, limit: Optional[int]):
    """Yield dict rows from the CSV with a sane field size limit.

    Some description cells are very long. csv defaults to 128KB which is
    fine for this dataset, but we bump it just in case.
    """
    csv.field_size_limit(2_000_000)
    with path.open("r", newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for index, row in enumerate(reader):
            if limit is not None and index >= limit:
                return
            yield row


def main() -> int:
    args = parse_args()

    if not args.csv.exists():
        log(f"ERROR: CSV not found at {args.csv}")
        return 2

    log(f"reading {args.csv}")

    if args.dry_run:
        log("DRY RUN: no Supabase writes will happen")
        previewed = 0
        for raw_row in iter_csv_rows(args.csv, args.limit or 5):
            payload = transform_row(raw_row)
            if not payload:
                log(f"  skip row {previewed}: no listing_id")
                previewed += 1
                continue
            log(f"  row {previewed}: listing_id={payload['listing_id']}")
            log(f"    name={payload.get('name')!r}")
            log(f"    price={payload.get('price')!r}")
            log(f"    weight_grams={payload.get('weight_grams')!r}")
            log(f"    trait_array={payload.get('trait_array')!r}")
            log(f"    is_active={payload.get('is_active')!r}")
            log(f"    first_seen_at={payload.get('first_seen_at')!r}")
            previewed += 1
        log(f"DRY RUN complete: previewed {previewed} rows")
        return 0

    supabase = get_supabase()

    if previous_csv_migration_succeeded(supabase) and not args.force:
        log(
            "ERROR: a previous csv_migration scrape_run already finished "
            "with status=success. Pass --force to run anyway."
        )
        return 3

    run_id = open_run(supabase)
    attempted = 0
    succeeded = 0
    failed = 0
    final_status = "success"
    error_message: Optional[str] = None

    try:
        listings_buffer: list[dict[str, Any]] = []
        history_buffer: list[dict[str, Any]] = []

        def flush_listings() -> None:
            nonlocal succeeded, failed
            if not listings_buffer:
                return
            # Deduplicate by listing_id within this batch. PostgreSQL rejects
            # UPSERTs that try to affect the same row twice in one statement
            # (ON CONFLICT DO UPDATE command cannot affect row a second time).
            # The full CSV has two duplicate listing_ids; keep the last
            # observation seen, which is also what the per-row loop would do.
            deduped: dict[str, dict[str, Any]] = {}
            for row in listings_buffer:
                deduped[row["listing_id"]] = row
            batch = list(deduped.values())
            merged = len(listings_buffer) - len(batch)
            try:
                supabase.table("listings").upsert(
                    batch, on_conflict="listing_id"
                ).execute()
                succeeded += len(batch)
                if merged:
                    log(
                        f"  upserted {len(batch)} listings "
                        f"({merged} duplicate(s) merged in batch, "
                        f"running total succeeded={succeeded})"
                    )
                else:
                    log(
                        f"  upserted {len(batch)} listings "
                        f"(running total succeeded={succeeded})"
                    )
            except Exception as exc:  # surface and keep going
                failed += len(batch)
                log(f"  ERROR upserting batch: {exc}")

            # Mirror into the canonical schema the public web app reads from.
            # Gated by env so a flaky canonical write never blocks a CSV run.
            dual_write = os.environ.get("CANONICAL_DUAL_WRITE", "1").lower() not in (
                "0", "false", "no", ""
            )
            if dual_write:
                try:
                    from lib.canonical import upsert_canonical_from_listings
                    stats = upsert_canonical_from_listings(supabase, batch)
                    log(
                        f"  canonical mirror: listings+={stats.listings_upserted} "
                        f"sellers+={stats.sellers_upserted} "
                        f"price_history+={stats.price_history_inserted}"
                    )
                except Exception as exc:  # noqa: BLE001
                    log(f"  WARN: canonical dual-write failed: {exc}")

            listings_buffer.clear()

        def flush_history() -> None:
            if args.skip_history or not history_buffer:
                history_buffer.clear()
                return
            try:
                supabase.table("listings_history").insert(
                    history_buffer
                ).execute()
                log(f"  appended {len(history_buffer)} listings_history rows")
            except Exception as exc:
                log(f"  ERROR inserting history batch: {exc}")
            finally:
                history_buffer.clear()

        for raw_row in iter_csv_rows(args.csv, args.limit):
            attempted += 1
            payload = transform_row(raw_row)
            if not payload:
                failed += 1
                if attempted <= 5 or attempted % 1000 == 0:
                    log(f"  skip row {attempted}: no listing_id")
                continue

            listings_buffer.append(payload)
            if not args.skip_history:
                history_buffer.append(
                    history_row(
                        payload,
                        raw_row,
                        run_id,
                        payload.get("first_seen_at"),
                    )
                )

            if len(listings_buffer) >= UPSERT_BATCH_SIZE:
                flush_listings()
            if len(history_buffer) >= HISTORY_BATCH_SIZE:
                flush_history()

            if attempted % 1000 == 0:
                log(f"progress: read {attempted} rows")

        flush_listings()
        flush_history()

        if failed and succeeded:
            final_status = "partial"
        elif failed and not succeeded:
            final_status = "failed"
            error_message = (
                f"all {failed} rows failed to upsert; check upstream errors above"
            )
    except Exception as exc:
        final_status = "failed"
        error_message = f"{type(exc).__name__}: {exc}"
        log(f"FATAL: {error_message}")
        traceback.print_exc()
    finally:
        close_run(
            supabase,
            run_id,
            status=final_status,
            attempted=attempted,
            succeeded=succeeded,
            failed=failed,
            error_message=error_message,
        )

    log(
        f"done. attempted={attempted} succeeded={succeeded} failed={failed} "
        f"status={final_status}"
    )
    return 0 if final_status in ("success", "partial") else 1


if __name__ == "__main__":
    sys.exit(main())
