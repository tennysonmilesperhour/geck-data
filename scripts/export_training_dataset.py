"""
Export the Morph ID training dataset.

Reads public.v_morph_training and writes:
  - train.jsonl     One line per training image
  - val.jsonl       Validation split
  - test.jsonl      Test split
  - taxonomy.json   The canonical trait list + index ordering used by the
                    multi-hot labels in the jsonl files

Each jsonl row:
    {"image_url": "...", "listing_id": "...", "traits": ["Harlequin","Red"],
     "labels": [0, 1, 0, 1, ...],   # multi-hot in taxonomy order
     "sex": "Male", "maturity": "Juvenile", "price": 600,
     "source": "scraper_primary", "split": "train"}

Run modes:
    python scripts/export_training_dataset.py
        Writes manifests to ./training_dataset/

    python scripts/export_training_dataset.py --download
        Also downloads every image to ./training_dataset/images/<split>/
        and rewrites image_url to the local path.

    python scripts/export_training_dataset.py --download --bucket
        After downloading, uploads the manifest+taxonomy to the
        listing-images Supabase Storage bucket under
        training_manifests/<UTC date>/ for the GH Action consumer.

Idempotent. Re-running overwrites the output directory.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

import requests

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from lib.supabase_client import get_supabase  # noqa: E402

DEFAULT_OUT = Path("./training_dataset")
PAGE_SIZE = 1000


def log(msg: str) -> None:
    ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    print(f"[{ts}] {msg}", flush=True)


def fetch_taxonomy(supabase) -> list[dict[str, Any]]:
    """Pull the canonical taxonomy in a stable order."""
    res = (
        supabase.table("crested_morph_taxonomy")
        .select("canonical_name,norm_name,category,synonyms")
        .order("category")
        .order("canonical_name")
        .execute()
    )
    return res.data or []


def fetch_training_rows(supabase) -> Iterable[dict[str, Any]]:
    """Page through v_morph_training. Yields rows lazily."""
    offset = 0
    while True:
        res = (
            supabase.table("v_morph_training")
            .select(
                "image_url,listing_id,traits,sex,maturity,price,currency,source,split",
            )
            .not_.is_("image_url", "null")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return
        for r in rows:
            yield r
        if len(rows) < PAGE_SIZE:
            return
        offset += len(rows)


def build_multi_hot(traits: list[str], trait_index: dict[str, int]) -> list[int]:
    labels = [0] * len(trait_index)
    for t in traits or []:
        idx = trait_index.get(t)
        if idx is not None:
            labels[idx] = 1
    return labels


def safe_filename(url: str, listing_id: str, source: str, idx: int) -> str:
    """Stable local filename derived from URL + listing_id."""
    parsed = urlparse(url)
    suffix = Path(parsed.path).suffix or ".jpg"
    if suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp", ".avif"):
        suffix = ".jpg"
    return f"{listing_id}__{source}__{idx}{suffix}"


def download_one(url: str, dest: Path, timeout: int = 30) -> tuple[bool, str]:
    if dest.exists() and dest.stat().st_size > 0:
        return (True, "cached")
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    try:
        r = requests.get(url, headers=headers, timeout=timeout, stream=True)
        if r.status_code != 200:
            return (False, f"http {r.status_code}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("wb") as fh:
            for chunk in r.iter_content(chunk_size=65536):
                if chunk:
                    fh.write(chunk)
        return (True, "ok")
    except Exception as exc:  # noqa: BLE001
        return (False, str(exc)[:60])


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Export the Morph ID training dataset."
    )
    p.add_argument("--out", type=Path, default=DEFAULT_OUT,
                   help=f"Output directory (default: {DEFAULT_OUT})")
    p.add_argument("--download", action="store_true",
                   help="Also download all images to <out>/images/<split>/")
    p.add_argument("--limit", type=int, default=None,
                   help="Stop after N rows; useful for smoke tests")
    p.add_argument("--workers", type=int, default=8,
                   help="Parallel download workers when --download is set")
    p.add_argument("--bucket", action="store_true",
                   help="Upload manifest files to listing-images Storage")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    supabase = get_supabase()

    # 1. Pull taxonomy and build the multi-hot index
    log("fetching taxonomy")
    taxonomy = fetch_taxonomy(supabase)
    trait_names = [t["canonical_name"] for t in taxonomy]
    trait_index = {name: i for i, name in enumerate(trait_names)}
    log(f"  taxonomy has {len(trait_names)} canonical traits")

    (out_dir / "taxonomy.json").write_text(
        json.dumps(
            {
                "version": dt.datetime.now(dt.timezone.utc).isoformat(),
                "traits": taxonomy,
                "label_order": trait_names,
            },
            indent=2,
        )
    )

    # 2. Stream training rows; bucket by split, optionally download
    splits = {
        "train": (out_dir / "train.jsonl").open("w"),
        "val":   (out_dir / "val.jsonl").open("w"),
        "test":  (out_dir / "test.jsonl").open("w"),
    }
    counts = {"train": 0, "val": 0, "test": 0, "skipped": 0}

    image_jobs: list[tuple[str, Path, dict[str, Any]]] = []

    for i, row in enumerate(fetch_training_rows(supabase)):
        if args.limit is not None and (counts["train"] + counts["val"] + counts["test"]) >= args.limit:
            break

        traits = row.get("traits") or []
        split = row.get("split") or "train"
        if split not in splits:
            counts["skipped"] += 1
            continue
        # Skip rows with no recognised traits — they're not useful for
        # multi-label training. Future: keep them for self-supervised
        # pre-training, with a flag.
        if not traits:
            counts["skipped"] += 1
            continue

        labels = build_multi_hot(traits, trait_index)
        record = {
            "image_url":  row["image_url"],
            "listing_id": row["listing_id"],
            "traits":     traits,
            "labels":     labels,
            "sex":        row.get("sex"),
            "maturity":   row.get("maturity"),
            "price":      row.get("price"),
            "currency":   row.get("currency"),
            "source":     row.get("source"),
            "split":      split,
        }

        if args.download:
            local = (
                out_dir / "images" / split
                / safe_filename(row["image_url"], row["listing_id"], row.get("source") or "x", i)
            )
            image_jobs.append((row["image_url"], local, record))
            record["local_path"] = str(local.relative_to(out_dir))
        else:
            record["local_path"] = None

        splits[split].write(json.dumps(record) + "\n")
        counts[split] += 1

    for fh in splits.values():
        fh.close()

    log(
        f"manifests written: train={counts['train']} val={counts['val']} "
        f"test={counts['test']} skipped={counts['skipped']}"
    )

    # 3. Optionally download images in parallel
    if args.download and image_jobs:
        log(f"downloading {len(image_jobs)} images, workers={args.workers}")
        ok = 0
        fail = 0
        started = time.time()
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = {ex.submit(download_one, url, dest): url
                       for url, dest, _ in image_jobs}
            for n, fut in enumerate(as_completed(futures), 1):
                success, reason = fut.result()
                if success:
                    ok += 1
                else:
                    fail += 1
                if n % 200 == 0:
                    rate = n / max(0.01, time.time() - started)
                    log(f"  {n}/{len(image_jobs)} ({rate:.1f}/s) ok={ok} fail={fail}")
        log(f"download complete: ok={ok} fail={fail}")

    # 4. Optionally upload the manifest + taxonomy to Storage
    if args.bucket:
        date_key = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
        for name in ("train.jsonl", "val.jsonl", "test.jsonl", "taxonomy.json"):
            src = out_dir / name
            key = f"training_manifests/{date_key}/{name}"
            try:
                with src.open("rb") as fh:
                    supabase.storage.from_("listing-images").upload(
                        key, fh.read(),
                        {"content-type": "application/x-ndjson" if name.endswith(".jsonl") else "application/json"},
                    )
                log(f"  uploaded {key}")
            except Exception as exc:  # noqa: BLE001
                msg = str(exc)
                if "Duplicate" in msg or "already exists" in msg:
                    log(f"  {key} already exists; skipping (rerun with date suffix to overwrite)")
                else:
                    log(f"  WARN upload failed for {key}: {msg[:120]}")

    log("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
