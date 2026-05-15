"""
Mirror GGSC anchor images to geck-inspect Supabase storage and upsert
gecko_images rows with the fast self-hosted URLs.

Why: Anthropic's image-prefetch budget gets exhausted when the morph-ID
edge function sends bank images sourced from slow external CDNs (Wix,
marketplace). Mirroring the bank source images to geck-inspect storage
keeps the prefetch on the same network as the model call and fixes the
~80% 500 rate we saw in eval run #8.

What it does, per row:
  1. Download image from external URL (e.g. wixstatic.com)
  2. Upload to geck-inspect-media/hero-anchors/<key>.jpg  (public bucket)
  3. Compute the public URL (https://<proj>.supabase.co/storage/...)
  4. Upsert gecko_images by (training_meta->>gecko_name, source):
     - if a row already exists for this winner: UPDATE image_url to the
       fast URL (idempotent on re-runs).
     - otherwise: INSERT a new hero_anchor row with the right anchor
       category (primary_morph / genetic_trait / base_color).

CSV columns: image_url, anchor_category, anchor_axis_id, primary_morph,
             genetic_trait, base_color, photo_credit, gecko_name, source,
             year, award

Idempotent: safe to re-run after partial failures.

Env vars:
  GECK_INSPECT_SUPABASE_URL
  GECK_INSPECT_SUPABASE_SERVICE_KEY
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

import requests
from supabase import Client, create_client


STORAGE_BUCKET = "geck-inspect-media"
STORAGE_PREFIX = "hero-anchors"
VERIFICATION_TIER = "hero_anchor"


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
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


def load_csv(path: Path) -> list[dict[str, Any]]:
    with path.open("r", newline="") as fh:
        return [{k.strip(): (v.strip() if isinstance(v, str) else v)
                 for k, v in row.items()} for row in csv.DictReader(fh)]


def slugify(value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return s or "unknown"


def storage_key(row: dict[str, Any]) -> str:
    """Stable per-winner path: hero-anchors/<source>/<slug-gecko-name>.jpg

    Stable across re-runs so we overwrite the same blob if the source
    image changes (e.g. site re-uploads at higher resolution).
    """
    source = slugify(row.get("source") or "unknown")
    name = slugify(row.get("gecko_name") or "unknown")
    return f"{STORAGE_PREFIX}/{source}/{name}.jpg"


def public_storage_url(supabase_url: str, key: str) -> str:
    return f"{supabase_url.rstrip('/')}/storage/v1/object/public/{STORAGE_BUCKET}/{key}"


def download_image(url: str, timeout: int = 30) -> tuple[bytes, str]:
    res = requests.get(url, timeout=timeout, headers={
        "User-Agent": "geck-data/ingest-show-winners",
    })
    res.raise_for_status()
    ctype = res.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
    return res.content, ctype


def upload_to_storage(client: Client, key: str, payload: bytes,
                      content_type: str) -> None:
    """Upsert into Supabase storage. On hash collision we just overwrite."""
    client.storage.from_(STORAGE_BUCKET).upload(
        path=key,
        file=payload,
        file_options={
            "content-type": content_type,
            "upsert": "true",
            "cache-control": "public, max-age=31536000",
        },
    )


def find_existing(client: Client, row: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Look up an existing row by gecko_name+source (the natural key)."""
    name = row.get("gecko_name") or ""
    source = row.get("source") or ""
    if not name or not source:
        return None
    res = (
        client.table("gecko_images")
        .select("id, image_url, training_meta")
        .filter("training_meta->>gecko_name", "eq", name)
        .filter("training_meta->>source", "eq", source)
        .limit(2)
        .execute()
    )
    rows = res.data or []
    if len(rows) > 1:
        print(f"  WARN: {len(rows)} matches for {name}@{source}; using first")
    return rows[0] if rows else None


def build_payload(row: dict[str, Any], fast_url: str) -> dict[str, Any]:
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    primary = row.get("primary_morph") or None
    genetic = row.get("genetic_trait") or None
    base = row.get("base_color") or None
    secondary_traits: list[str] = []
    genetic_traits = [genetic] if genetic else []
    return {
        "image_url": fast_url,
        "primary_morph": primary,
        "secondary_traits": secondary_traits,
        "base_color": base,
        "pattern_intensity": "medium",
        "white_amount": "medium",
        "fired_state": "unknown",
        "confidence_score": 95,
        "verified": True,
        "age_estimate": "adult",
        "created_date": now_iso,
        "training_meta": {
            "verification_tier": VERIFICATION_TIER,
            "anchor_category": row.get("anchor_category"),     # primary_morph | genetic_trait | base_color
            "anchor_axis_id":   row.get("anchor_axis_id"),     # which id this anchor anchors
            "provenance":  row.get("source") or "show_winner",
            "source":      row.get("source") or None,
            "year":        row.get("year") or None,
            "award":       row.get("award") or None,
            "gecko_name":  row.get("gecko_name") or None,
            "photo_credit": row.get("photo_credit") or None,
            "genetic_traits": genetic_traits,
            "external_image_url": row.get("image_url"),         # remember original
            "ingested_at": now_iso,
        },
    }


def upsert_row(client: Client, row: dict[str, Any], fast_url: str) -> str:
    """Returns 'inserted' or 'updated'."""
    existing = find_existing(client, row)
    payload = build_payload(row, fast_url)
    if existing:
        merged_meta = dict(existing.get("training_meta") or {})
        merged_meta.update(payload["training_meta"])
        update_payload = {k: v for k, v in payload.items()
                          if k not in {"created_date"}}
        update_payload["training_meta"] = merged_meta
        client.table("gecko_images").update(update_payload).eq(
            "id", existing["id"]
        ).execute()
        return "updated"
    client.table("gecko_images").insert(payload).execute()
    return "inserted"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--csv", type=Path, required=True,
                   help="Path to the winners CSV.")
    p.add_argument("--dry-run", action="store_true",
                   help="Validate + preview without uploading or writing.")
    p.add_argument("--limit", type=int, default=None,
                   help="Cap to first N rows.")
    p.add_argument("--skip-existing", action="store_true",
                   help="Skip rows whose storage object already exists.")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    _load_dotenv()
    rows = load_csv(args.csv)
    if args.limit:
        rows = rows[: args.limit]
    print(f"loaded {len(rows)} rows from {args.csv}")

    if args.dry_run:
        print("DRY RUN — first 2 translated payloads:")
        for r in rows[:2]:
            key = storage_key(r)
            payload = build_payload(r, f"https://EXAMPLE/{STORAGE_BUCKET}/{key}")
            print(json.dumps({"key": key, "payload": payload}, indent=2))
        return 0

    client = get_geck_inspect_client()
    supabase_url = os.environ["GECK_INSPECT_SUPABASE_URL"]

    mirrored = updated = inserted = failed = 0
    for i, row in enumerate(rows, 1):
        ext_url = row["image_url"]
        key = storage_key(row)
        try:
            payload, ctype = download_image(ext_url)
            upload_to_storage(client, key, payload, ctype)
            fast_url = public_storage_url(supabase_url, key)
            result = upsert_row(client, row, fast_url)
            mirrored += 1
            if result == "inserted":
                inserted += 1
            else:
                updated += 1
            print(f"  [{i}/{len(rows)}] {result.upper():8s} "
                  f"{row.get('award','?'):24s} "
                  f"{row.get('gecko_name','?'):28s} → {key}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  [{i}/{len(rows)}] FAIL {row.get('gecko_name')}: "
                  f"{str(exc)[:150]}", file=sys.stderr)

    print(f"\ndone. mirrored={mirrored} inserted={inserted} "
          f"updated={updated} failed={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
