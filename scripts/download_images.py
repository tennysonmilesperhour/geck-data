"""
Weekly image download. For every listing whose primary_image_url still
points at MorphMarket's CDN, download the image, upload it to the
Supabase Storage `listing-images` bucket, and rewrite the listings row
to point at the new public Supabase URL.

This script does NOT use Decodo. MorphMarket image URLs are public CDN
links so we can fetch them directly. That saves credits.

Storage layout: one file per listing at `{listing_id}.{ext}` in the
public `listing-images` bucket.

Env vars consumed: SUPABASE_URL, SUPABASE_SERVICE_KEY, TRIGGERED_BY,
MAX_IMAGES (optional smoke-test cap).
"""
from __future__ import annotations

import datetime as dt
import mimetypes
import os
import sys
import traceback
from typing import Optional
from urllib.parse import urlparse

import requests

from lib.supabase_client import get_supabase, get_supabase_url

BUCKET = "listing-images"
DOWNLOAD_TIMEOUT_SECONDS = 30
DEFAULT_EXTENSION = ".jpg"

DOWNLOAD_HEADERS = {
    # MorphMarket CDN rejects requests without a UA. Pretend to be a normal
    # browser fetching an embedded image.
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}


def log(message: str) -> None:
    ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    print(f"[{ts}] {message}", flush=True)


def start_scrape_run(supabase) -> int:
    triggered_by = os.environ.get("TRIGGERED_BY", "manual")
    row = (
        supabase.table("scrape_runs")
        .insert(
            {
                "scrape_type": "images",
                "status": "running",
                "triggered_by": triggered_by,
            }
        )
        .execute()
    )
    return int(row.data[0]["id"])


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


def pick_extension(url: str, content_type: Optional[str]) -> str:
    """Return a sensible file extension for the downloaded image."""
    parsed = urlparse(url)
    name = os.path.basename(parsed.path or "")
    _, ext = os.path.splitext(name)
    if ext and len(ext) <= 5:
        return ext.lower()
    if content_type:
        guess = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if guess:
            return guess
    return DEFAULT_EXTENSION


def storage_path_for(listing_id: str, extension: str) -> str:
    """`{listing_id}.{ext}` with no folder prefix; bucket is flat."""
    return f"{listing_id}{extension}"


def upload_to_bucket(supabase, *, path: str, content: bytes, content_type: str) -> None:
    """Upload bytes to Supabase Storage, replacing any existing file."""
    storage = supabase.storage.from_(BUCKET)
    try:
        storage.upload(
            path=path,
            file=content,
            file_options={
                "content-type": content_type,
                "upsert": "true",
            },
        )
    except Exception as exc:  # noqa: BLE001
        # supabase-py raises on non-2xx; surface a friendlier error.
        raise RuntimeError(f"storage upload failed for {path}: {exc}") from exc


def build_public_url(base: str, path: str) -> str:
    return f"{base}/storage/v1/object/public/{BUCKET}/{path}"


def main() -> int:
    max_env = os.environ.get("MAX_IMAGES")
    max_images = int(max_env) if max_env else None

    supabase = get_supabase()
    base_url = get_supabase_url()
    run_id = start_scrape_run(supabase)
    attempted = succeeded = failed = 0

    try:
        log("calling listings_needing_image_download()")
        rpc = supabase.rpc("listings_needing_image_download").execute()
        todo: list[dict] = rpc.data or []
        if max_images:
            todo = todo[:max_images]
        log(f"need to download {len(todo)} images")

        for listing in todo:
            attempted += 1
            listing_id = str(listing.get("listing_id") or "").strip()
            image_url = listing.get("primary_image_url")
            if not listing_id or not image_url:
                failed += 1
                continue

            try:
                resp = requests.get(
                    image_url,
                    headers=DOWNLOAD_HEADERS,
                    timeout=DOWNLOAD_TIMEOUT_SECONDS,
                )
            except requests.RequestException as exc:
                log(f"WARN download failed for {listing_id}: {exc}")
                failed += 1
                continue

            if resp.status_code != 200 or not resp.content:
                log(
                    f"WARN download status={resp.status_code} for {listing_id}"
                )
                failed += 1
                continue

            content_type = resp.headers.get("Content-Type", "image/jpeg")
            ext = pick_extension(image_url, content_type)
            path = storage_path_for(listing_id, ext)

            try:
                upload_to_bucket(
                    supabase,
                    path=path,
                    content=resp.content,
                    content_type=content_type,
                )
            except Exception as exc:  # noqa: BLE001
                log(f"WARN upload failed for {listing_id}: {exc}")
                failed += 1
                continue

            new_url = build_public_url(base_url, path)
            try:
                supabase.table("listings").update(
                    {"primary_image_url": new_url}
                ).eq("listing_id", listing_id).execute()
                succeeded += 1
            except Exception as exc:  # noqa: BLE001
                log(f"WARN row update failed for {listing_id}: {exc}")
                failed += 1
                continue

            if attempted % 50 == 0:
                log(
                    f"progress: attempted={attempted} succeeded={succeeded} "
                    f"failed={failed}"
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


if __name__ == "__main__":
    sys.exit(main())
