"""
One-time helper: bulk upload the ~5,849 primary images already on
Tennyson's Mac (`~/Desktop/geckscrape/images/`) into the Supabase
Storage `listing-images` bucket, then rewrite each listings row's
primary_image_url to the new public Supabase URL.

Run LOCALLY on the Mac that has the images. Do NOT run this in
GitHub Actions, the runner does not have access to your Desktop.

Usage:
  python scripts/upload_local_images.py
  python scripts/upload_local_images.py --dir ~/Desktop/geckscrape/images
  python scripts/upload_local_images.py --dry-run
  python scripts/upload_local_images.py --limit 10

Safe to re-run: --skip-existing (default) checks Supabase Storage and
skips files that have already been uploaded. Use --force to re-upload
everything.

Env vars consumed: SUPABASE_URL, SUPABASE_SERVICE_KEY.
"""
from __future__ import annotations

import argparse
import datetime as dt
import mimetypes
import os
import sys
from pathlib import Path
from typing import Optional

from lib.supabase_client import get_supabase, get_supabase_url

BUCKET = "listing-images"
DEFAULT_LOCAL_DIR = "~/Desktop/geckscrape/images"
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def log(message: str) -> None:
    ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    print(f"[{ts}] {message}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dir",
        default=DEFAULT_LOCAL_DIR,
        help="Directory containing {listing_id}.{ext} image files",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after N files (smoke testing)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Walk files and print what would happen, but do not upload",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-upload even if the file already exists in the bucket",
    )
    parser.add_argument(
        "--no-update-rows",
        action="store_true",
        help="Skip updating listings.primary_image_url (storage only)",
    )
    return parser.parse_args()


def list_storage_objects(supabase) -> set[str]:
    """Return the set of filenames already present in the bucket."""
    storage = supabase.storage.from_(BUCKET)
    existing: set[str] = set()
    # Supabase storage list() defaults to 100 per call; loop with offset
    # so we get every file.
    offset = 0
    page_size = 1000
    while True:
        try:
            items = storage.list(
                path="",
                options={"limit": page_size, "offset": offset},
            )
        except Exception as exc:  # noqa: BLE001
            log(f"WARN: could not list bucket objects: {exc}")
            break
        if not items:
            break
        for item in items:
            name = item.get("name") if isinstance(item, dict) else None
            if name:
                existing.add(name)
        if len(items) < page_size:
            break
        offset += page_size
    log(f"bucket already contains {len(existing)} files")
    return existing


def main() -> int:
    args = parse_args()
    images_dir = Path(os.path.expanduser(args.dir)).resolve()
    if not images_dir.exists():
        log(f"ERROR: directory does not exist: {images_dir}")
        return 1

    supabase = get_supabase()
    base_url = get_supabase_url()

    files = sorted(
        f for f in images_dir.iterdir()
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    log(f"found {len(files)} image files in {images_dir}")
    if args.limit:
        files = files[: args.limit]
        log(f"limited to first {len(files)} files for this run")

    existing: set[str] = set()
    if not args.force and not args.dry_run:
        existing = list_storage_objects(supabase)

    storage = supabase.storage.from_(BUCKET)
    uploaded = skipped = failed = updated = 0

    for path in files:
        listing_id = path.stem
        target_name = path.name
        if not listing_id:
            failed += 1
            continue

        if target_name in existing and not args.force:
            skipped += 1
            if args.no_update_rows:
                continue
            # Still update the row in case it points at the MM CDN.
            public_url = f"{base_url}/storage/v1/object/public/{BUCKET}/{target_name}"
            try:
                supabase.table("listings").update(
                    {"primary_image_url": public_url}
                ).eq("listing_id", listing_id).execute()
                updated += 1
            except Exception as exc:  # noqa: BLE001
                log(f"WARN row update failed for {listing_id}: {exc}")
            continue

        if args.dry_run:
            log(f"DRY: would upload {target_name}")
            continue

        try:
            content = path.read_bytes()
            content_type, _ = mimetypes.guess_type(path.name)
            content_type = content_type or "image/jpeg"
            storage.upload(
                path=target_name,
                file=content,
                file_options={
                    "content-type": content_type,
                    "upsert": "true",
                },
            )
            uploaded += 1
        except Exception as exc:  # noqa: BLE001
            log(f"WARN upload failed for {target_name}: {exc}")
            failed += 1
            continue

        if args.no_update_rows:
            continue

        public_url = f"{base_url}/storage/v1/object/public/{BUCKET}/{target_name}"
        try:
            supabase.table("listings").update(
                {"primary_image_url": public_url}
            ).eq("listing_id", listing_id).execute()
            updated += 1
        except Exception as exc:  # noqa: BLE001
            log(f"WARN row update failed for {listing_id}: {exc}")

        if (uploaded + skipped) % 100 == 0:
            log(
                f"progress: uploaded={uploaded} skipped={skipped} "
                f"updated={updated} failed={failed}"
            )

    log(
        f"done: uploaded={uploaded} skipped={skipped} updated={updated} "
        f"failed={failed}"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
