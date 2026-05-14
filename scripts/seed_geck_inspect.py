"""
Seed geck-inspect.gecko_images from geck-data's wild MorphMarket corpus.

The Morph ID tool (recognize-gecko-morph edge function) in geck-inspect
runs against a curated `gecko_images` table whose labels are the source
of truth for evals and any future fine-tuning. Today that table is
hand-populated through the /training expert-contribution form, which
scales poorly.

This script pushes scraper-sourced (image_url, primary_morph,
genetic_traits[], secondary_traits[], base_color) tuples from
geck-data's v_morph_training_canonical view into geck-inspect's
gecko_images table with verified=false. They land in the existing
reviewer queue (`AIFeedbackQueue` orders by created_date asc, where
verified IS NOT TRUE) so an expert can verify, correct, or reject each
one. The provenance is tagged training_meta.provenance='geck-data-scraper'.

Requires two Supabase service-role keys: the geck-data one (which the
existing scripts already use) plus the geck-inspect one.

Env vars consumed:
  SUPABASE_URL                     (geck-data)
  SUPABASE_SERVICE_ROLE_KEY        (geck-data)
  GECK_INSPECT_SUPABASE_URL        (e.g. https://mmuglfphhwlaluyfyxsp.supabase.co)
  GECK_INSPECT_SUPABASE_SERVICE_KEY

Usage:
  python scripts/seed_geck_inspect.py --dry-run --limit 5
  python scripts/seed_geck_inspect.py --limit 50
  python scripts/seed_geck_inspect.py                       # full push
  python scripts/seed_geck_inspect.py --split train         # only train rows
  python scripts/seed_geck_inspect.py --primary-morph harlequin

Idempotent: writes are upserts keyed on image_url, so re-running picks
up new scraper rows without duplicating.
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

from supabase import Client, create_client

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from lib.supabase_client import get_supabase  # geck-data side

PAGE_SIZE = 200
BATCH_SIZE = 50
TAXONOMY_VERSION = "2026.04.17"  # match geck-inspect taxonomy.ts


def log_setup() -> logging.Logger:
    logger = logging.getLogger("seed_geck_inspect")
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("[%(asctime)s] %(message)s", "%Y-%m-%dT%H:%M:%S"))
    logger.addHandler(handler)
    return logger


def get_geck_inspect_client() -> Client:
    """Return a Supabase client connected to geck-inspect's project."""
    url = os.environ.get("GECK_INSPECT_SUPABASE_URL")
    key = (
        os.environ.get("GECK_INSPECT_SUPABASE_SERVICE_KEY")
        or os.environ.get("GECK_INSPECT_SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url:
        sys.exit(
            "ERROR: GECK_INSPECT_SUPABASE_URL not set. Export it before running. "
            "e.g. https://mmuglfphhwlaluyfyxsp.supabase.co"
        )
    if not key:
        sys.exit(
            "ERROR: GECK_INSPECT_SUPABASE_SERVICE_KEY not set. Get it from "
            "geck-inspect's Supabase dashboard > Project Settings > API > "
            "service_role secret. Treat it like a password — never commit."
        )
    if "supabase.co" not in url:
        sys.exit(f"ERROR: GECK_INSPECT_SUPABASE_URL doesn't look right: {url!r}")
    return create_client(url, key)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--dry-run", action="store_true",
                   help="Show the first N translated rows, no writes")
    p.add_argument("--limit", type=int, default=None,
                   help="Stop after N source rows")
    p.add_argument("--split", choices=("train", "val", "test"), default=None,
                   help="Only seed rows from this split")
    p.add_argument("--primary-morph", type=str, default=None,
                   help="Only seed rows whose primary_morph matches this id")
    p.add_argument("--skip-existing", action="store_true", default=True,
                   help="Skip rows whose image_url already exists in gecko_images "
                        "(default: on)")
    return p.parse_args()


def fetch_canonical_rows(
    supabase: Client,
    *,
    split: Optional[str],
    primary_morph: Optional[str],
):
    """Page through v_morph_training_canonical."""
    offset = 0
    while True:
        q = supabase.table("v_morph_training_canonical").select(
            "image_url,listing_id,primary_morph,genetic_traits,"
            "secondary_traits,base_color,sex,maturity,price,currency,source,split,original_traits"
        ).order("listing_id").range(offset, offset + PAGE_SIZE - 1)
        if split:
            q = q.eq("split", split)
        if primary_morph:
            q = q.eq("primary_morph", primary_morph)
        rows = (q.execute().data or [])
        if not rows:
            return
        for r in rows:
            yield r
        if len(rows) < PAGE_SIZE:
            return
        offset += len(rows)


def fetch_existing_image_urls(geck_inspect: Client, urls: list[str]) -> set[str]:
    """Return the subset of urls that already exist in gecko_images."""
    if not urls:
        return set()
    existing: set[str] = set()
    # Supabase REST 'in' has a ~1000-item limit; chunk to be safe.
    for i in range(0, len(urls), 500):
        chunk = urls[i:i+500]
        res = geck_inspect.table("gecko_images").select(
            "image_url"
        ).in_("image_url", chunk).execute()
        for row in (res.data or []):
            if row.get("image_url"):
                existing.add(row["image_url"])
    return existing


def build_gecko_image_row(src: dict[str, Any]) -> dict[str, Any]:
    """Translate a v_morph_training_canonical row to a gecko_images insert."""
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    return {
        # Required-ish fields
        "image_url": src["image_url"],
        "primary_morph": src.get("primary_morph"),
        "secondary_traits": src.get("secondary_traits") or [],
        "base_color": src.get("base_color"),
        "pattern_intensity": "medium",  # neutral default; reviewer corrects
        "white_amount": "medium",
        "fired_state": "unknown",
        "age_estimate": (src.get("maturity") or "unknown").lower() or "unknown",
        "confidence_score": 60,  # below "auto-verified"; flags reviewer attention
        "verified": False,
        "created_date": now,
        # Rich provenance for the reviewer + downstream filter queries
        "training_meta": {
            "provenance": "geck-data-scraper",
            "geck_data_listing_id": src.get("listing_id"),
            "geck_data_split": src.get("split"),
            "geck_data_source": src.get("source"),
            "scraper_traits": src.get("original_traits"),
            "genetic_traits": src.get("genetic_traits") or [],
            "ai_original": None,         # no AI prediction yet; eval can fill this
            "reviewer_verdict": None,
            "taxonomy_version": TAXONOMY_VERSION,
            "scraper_observed_price": src.get("price"),
        },
    }


def chunked(lst: list[Any], size: int):
    for i in range(0, len(lst), size):
        yield lst[i:i+size]


def main() -> int:
    args = parse_args()
    logger = log_setup()

    geck_data = get_supabase()

    rows_iter = fetch_canonical_rows(
        geck_data, split=args.split, primary_morph=args.primary_morph,
    )

    if args.dry_run:
        logger.info("DRY RUN: previewing the first 5 translated rows")
        n = 0
        for src in rows_iter:
            if n >= 5:
                break
            translated = build_gecko_image_row(src)
            logger.info(f"  -- example {n + 1} --")
            logger.info(f"    image_url:     {translated['image_url']}")
            logger.info(f"    primary_morph: {translated['primary_morph']}")
            logger.info(f"    genetic:       {translated['training_meta']['genetic_traits']}")
            logger.info(f"    secondary:     {translated['secondary_traits']}")
            logger.info(f"    base_color:    {translated['base_color']}")
            logger.info(f"    age_estimate:  {translated['age_estimate']}")
            n += 1
        logger.info("done. no writes.")
        return 0

    geck_inspect = get_geck_inspect_client()
    logger.info("connected to geck-inspect Supabase")

    # Buffer-and-flush loop. Skip already-present rows when --skip-existing.
    pending: list[dict[str, Any]] = []
    seen = 0
    inserted = 0
    skipped_existing = 0
    failed = 0

    def flush():
        nonlocal inserted, failed
        if not pending:
            return
        if args.skip_existing:
            existing = fetch_existing_image_urls(
                geck_inspect, [r["image_url"] for r in pending],
            )
        else:
            existing = set()
        to_write = [r for r in pending if r["image_url"] not in existing]
        if existing:
            nonlocal skipped_existing
            skipped_existing += len(existing)
        for batch in chunked(to_write, BATCH_SIZE):
            try:
                geck_inspect.table("gecko_images").insert(batch).execute()
                inserted += len(batch)
            except Exception as exc:  # noqa: BLE001
                failed += len(batch)
                logger.warning(f"insert batch of {len(batch)} failed: {exc}")
        pending.clear()

    try:
        for src in rows_iter:
            if args.limit is not None and seen >= args.limit:
                break
            seen += 1
            pending.append(build_gecko_image_row(src))
            if len(pending) >= PAGE_SIZE:
                flush()
                logger.info(
                    f"  progress: seen={seen} inserted={inserted} "
                    f"skipped={skipped_existing} failed={failed}"
                )
        flush()
    except KeyboardInterrupt:
        logger.info("interrupted; flushing what we have")
        flush()

    logger.info(
        f"done. seen={seen} inserted={inserted} "
        f"skipped_existing={skipped_existing} failed={failed}"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
