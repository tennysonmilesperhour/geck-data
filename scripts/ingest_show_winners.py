"""
Ingest competition / show-winner photos into geck-inspect.gecko_images as
canonical morph anchors. These are the photos the Morph ID tool draws on
for few-shot reference and the Morph Guide UI surfaces as the
authoritative example per morph.

Source format — either CSV (with a header row) or JSONL. Required columns:

  image_url       Direct URL to the photo (https://... only)
  primary_morph   Canonical id from PRIMARY_MORPH_IDS (e.g. harlequin,
                  extreme_harlequin, super_dalmatian)

Optional columns:

  base_color      Canonical id from BASE_COLOR_IDS
  genetic_traits  Pipe-delimited list (e.g. lily_white|cappuccino)
  secondary_traits Pipe-delimited list
  photo_credit    "Photo by <breeder> · <event>" — surfaced in UI
  gecko_name      Animal name / call name if known
  source          Event identifier (e.g. ggsc_2024, tikis_2023)
  year            4-digit year
  award           Best of class / 1st place / etc.

Idempotent on image_url: re-running won't duplicate.

Env vars:
  GECK_INSPECT_SUPABASE_URL
  GECK_INSPECT_SUPABASE_SERVICE_KEY

Usage:

  python scripts/ingest_show_winners.py --csv ./ggsc_2024_winners.csv
  python scripts/ingest_show_winners.py --jsonl ./tikis_winners.jsonl --dry-run
  python scripts/ingest_show_winners.py --csv ... --download   # also
      mirrors images to geck-inspect storage (skips if already hosted there)
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import requests
from supabase import Client, create_client

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))


VERIFICATION_TIER = "hero_anchor"

# Mirror geck-inspect/supabase/functions/recognize-gecko-morph/taxonomy.ts
PRIMARY_MORPH_IDS = {
    "patternless", "flame", "chevron_flame", "harlequin", "extreme_harlequin",
    "super_harlequin", "pinstripe", "full_pinstripe", "partial_pinstripe",
    "phantom_pinstripe", "reverse_pinstripe", "quad_stripe", "super_stripe",
    "tiger", "super_tiger", "brindle", "extreme_brindle", "dalmatian",
    "super_dalmatian", "red_dalmatian", "ink_spot", "bicolor", "tricolor",
}
GENETIC_TRAIT_IDS = {
    "lily_white", "axanthic_vca", "axanthic_tsm", "cappuccino", "frappuccino",
    "moonglow", "soft_scale", "whiteout", "empty_back", "white_wall",
    "hypo", "melanistic",
}


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return
    repo_root = Path(__file__).resolve().parents[1]
    for candidate in (repo_root / ".env.local", repo_root / ".env"):
        if candidate.exists():
            load_dotenv(candidate, override=False)
            return


def get_geck_inspect_client() -> Client:
    url = os.environ.get("GECK_INSPECT_SUPABASE_URL")
    key = (
        os.environ.get("GECK_INSPECT_SUPABASE_SERVICE_KEY")
        or os.environ.get("GECK_INSPECT_SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        sys.exit("ERROR: set GECK_INSPECT_SUPABASE_URL and "
                 "GECK_INSPECT_SUPABASE_SERVICE_KEY in .env.local.")
    return create_client(url, key)


def parse_pipe_list(value: Any) -> list[str]:
    if not value:
        return []
    return [v.strip() for v in str(value).split("|") if v.strip()]


def load_manifest(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".jsonl":
        rows: list[dict[str, Any]] = []
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
        return rows
    rows = []
    with path.open("r", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append({k.strip(): v.strip() if isinstance(v, str) else v
                         for k, v in row.items()})
    return rows


def validate_row(row: dict[str, Any]) -> Optional[str]:
    """Return error message if invalid, else None."""
    url = row.get("image_url", "").strip()
    if not url:
        return "image_url is required"
    if not url.startswith("http"):
        return f"image_url must be http(s): {url[:60]}"
    morph = row.get("primary_morph", "").strip()
    if not morph:
        return "primary_morph is required"
    if morph not in PRIMARY_MORPH_IDS:
        return f"primary_morph '{morph}' not in canonical list — see taxonomy.ts"
    for gt in parse_pipe_list(row.get("genetic_traits")):
        if gt not in GENETIC_TRAIT_IDS:
            return f"genetic_trait '{gt}' not in canonical list"
    return None


def url_exists(geck_inspect: Client, url: str) -> bool:
    res = geck_inspect.table("gecko_images").select(
        "id", count="exact", head=True
    ).eq("image_url", url).execute()
    return (res.count or 0) > 0


def build_payload(row: dict[str, Any]) -> dict[str, Any]:
    """Translate a manifest row into a gecko_images insert payload."""
    genetic_traits = parse_pipe_list(row.get("genetic_traits"))
    secondary_traits = parse_pipe_list(row.get("secondary_traits"))
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    return {
        "image_url": row["image_url"].strip(),
        "primary_morph": row["primary_morph"].strip(),
        "secondary_traits": secondary_traits,
        "base_color": (row.get("base_color") or None) or None,
        "pattern_intensity": row.get("pattern_intensity") or "medium",
        "white_amount": row.get("white_amount") or "medium",
        "fired_state": row.get("fired_state") or "unknown",
        "confidence_score": 95,  # show-judged photos warrant high confidence
        "verified": True,
        "age_estimate": (row.get("age_estimate") or "adult"),
        "created_date": now_iso,
        "training_meta": {
            "verification_tier": VERIFICATION_TIER,
            "provenance": (row.get("source") or "show_winner"),
            "year": row.get("year") or None,
            "award": row.get("award") or None,
            "gecko_name": row.get("gecko_name") or None,
            "photo_credit": row.get("photo_credit") or None,
            "genetic_traits": genetic_traits,
            "ingested_at": now_iso,
        },
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Ingest show-winner photos into geck-inspect.gecko_images.",
    )
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv",   type=Path, help="Path to a CSV manifest.")
    src.add_argument("--jsonl", type=Path, help="Path to a JSONL manifest.")
    p.add_argument("--dry-run", action="store_true",
                   help="Validate and preview; no writes.")
    p.add_argument("--limit", type=int, default=None,
                   help="Stop after N rows (smoke test).")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    _load_dotenv()

    path: Path = args.csv or args.jsonl
    if not path.exists():
        print(f"FATAL: {path} not found", file=sys.stderr)
        return 2

    rows = load_manifest(path)
    if args.limit:
        rows = rows[: args.limit]
    print(f"loaded {len(rows)} rows from {path}")

    # Validate everything up-front; abort on first error.
    for i, row in enumerate(rows, 1):
        err = validate_row(row)
        if err:
            print(f"FATAL row {i}: {err}", file=sys.stderr)
            return 3

    if args.dry_run:
        print("DRY RUN — first 3 translated payloads:")
        for r in rows[:3]:
            payload = build_payload(r)
            print(json.dumps(payload, indent=2))
        return 0

    geck_inspect = get_geck_inspect_client()
    inserted = 0
    skipped = 0
    failed = 0

    for i, row in enumerate(rows, 1):
        url = row["image_url"].strip()
        if url_exists(geck_inspect, url):
            skipped += 1
            if i <= 3 or i % 50 == 0:
                print(f"  [{i}/{len(rows)}] SKIP already present: {url[:80]}")
            continue
        payload = build_payload(row)
        try:
            geck_inspect.table("gecko_images").insert(payload).execute()
            inserted += 1
            if i <= 3 or i % 50 == 0:
                morph = payload["primary_morph"]
                credit = (payload["training_meta"].get("photo_credit") or "")[:40]
                print(f"  [{i}/{len(rows)}] INSERT {morph} · {credit}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  [{i}/{len(rows)}] FAIL: {str(exc)[:120]}", file=sys.stderr)

    print(f"\ndone. inserted={inserted} skipped={skipped} failed={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
