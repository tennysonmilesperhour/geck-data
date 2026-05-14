"""
Measure the recognize-gecko-morph edge function's accuracy against
geck-data's wild MorphMarket corpus.

For each image in the test split, call the edge function and compare its
predicted primary_morph + genetic_traits to the seller-reported labels.
Reports:

  - overall primary_morph top-1 accuracy
  - per-primary_morph precision / recall
  - genetic_trait Jaccard agreement
  - confusion matrix (top N most-confused pairs)

Seller labels are NOT ground truth — they're noisy and aspirational.
But on aggregate, agreement rate is a useful signal for whether the
tool's prompt + taxonomy are calibrated. Real accuracy comes from the
geck-inspect verified set.

Env vars consumed:
  GECK_INSPECT_FUNCTION_URL    e.g. https://<ref>.supabase.co/functions/v1
  GECK_INSPECT_ANON_KEY        the public anon JWT (for invoking the edge fn)

Usage:
  python scripts/eval_morph_id.py --limit 50      # quick eval
  python scripts/eval_morph_id.py --split test    # full test split
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from lib.supabase_client import get_supabase  # noqa: E402

PAGE_SIZE = 200


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--split", choices=("train", "val", "test"), default="test")
    p.add_argument("--limit", type=int, default=200,
                   help="Cap on images to eval (the edge function isn't free)")
    p.add_argument("--out", type=Path, default=Path("./morph_id_eval.json"))
    p.add_argument("--qps", type=float, default=1.0,
                   help="Max queries per second (rate limit to be polite)")
    return p.parse_args()


def call_recognize(image_url: str, fn_url: str, anon_key: str) -> dict[str, Any]:
    res = requests.post(
        f"{fn_url}/recognize-gecko-morph",
        headers={
            "Authorization": f"Bearer {anon_key}",
            "Content-Type": "application/json",
        },
        json={"imageUrl": image_url},
        timeout=60,
    )
    res.raise_for_status()
    body = res.json()
    if not body.get("success"):
        raise RuntimeError(f"edge function error: {body}")
    return body["analysis"]


def jaccard(a: list[str], b: list[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return 1.0
    return len(sa & sb) / max(1, len(sa | sb))


def main() -> int:
    args = parse_args()

    fn_url = os.environ.get("GECK_INSPECT_FUNCTION_URL")
    anon_key = os.environ.get("GECK_INSPECT_ANON_KEY")
    if not fn_url or not anon_key:
        sys.exit(
            "ERROR: set GECK_INSPECT_FUNCTION_URL and GECK_INSPECT_ANON_KEY. "
            "Function URL looks like https://<ref>.supabase.co/functions/v1; "
            "anon key is the public JWT from geck-inspect's API settings."
        )

    supabase = get_supabase()

    # Pull canonical rows from the canonical view so labels are already mapped
    # to geck-inspect's taxonomy.
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        res = supabase.table("v_morph_training_canonical").select(
            "image_url,primary_morph,genetic_traits,split,listing_id"
        ).eq("split", args.split).not_.is_("primary_morph", "null").range(
            offset, offset + PAGE_SIZE - 1
        ).execute()
        data = res.data or []
        rows.extend(data)
        if len(data) < PAGE_SIZE:
            break
        offset += len(data)
        if args.limit is not None and len(rows) >= args.limit:
            rows = rows[: args.limit]
            break
    print(f"eval set: {len(rows)} images")

    results: list[dict[str, Any]] = []
    correct_primary = 0
    interval = 1.0 / max(args.qps, 0.01)
    last_t = 0.0

    for i, row in enumerate(rows):
        wait = interval - (time.time() - last_t)
        if wait > 0:
            time.sleep(wait)
        last_t = time.time()
        url = row["image_url"]
        try:
            analysis = call_recognize(url, fn_url, anon_key)
        except Exception as exc:  # noqa: BLE001
            print(f"  [{i+1}/{len(rows)}] FAIL {url}: {str(exc)[:80]}")
            results.append({"image_url": url, "error": str(exc)[:120], "label": row})
            continue
        pred = analysis.get("primary_morph")
        truth = row["primary_morph"]
        match = pred == truth
        if match:
            correct_primary += 1
        results.append({
            "image_url": url,
            "label": row,
            "prediction": analysis,
            "primary_match": match,
            "genetic_jaccard": jaccard(
                row.get("genetic_traits") or [], analysis.get("genetic_traits") or [],
            ),
        })
        if (i + 1) % 10 == 0:
            print(f"  [{i+1}/{len(rows)}] primary_acc so far = "
                  f"{correct_primary / (i + 1):.3f}")

    # Aggregate
    n_evaluated = sum(1 for r in results if "prediction" in r)
    primary_acc = correct_primary / max(1, n_evaluated)
    avg_jaccard = (
        sum(r.get("genetic_jaccard", 0) for r in results if "prediction" in r)
        / max(1, n_evaluated)
    )

    confusion = collections.Counter()
    for r in results:
        if "prediction" not in r:
            continue
        confusion[(r["label"]["primary_morph"],
                   r["prediction"].get("primary_morph"))] += 1
    top_confusions = sorted(
        ((k, v) for k, v in confusion.items() if k[0] != k[1]),
        key=lambda kv: -kv[1],
    )[:10]

    summary = {
        "eval_set_size": n_evaluated,
        "primary_morph_top1_accuracy": round(primary_acc, 4),
        "genetic_trait_jaccard_avg": round(avg_jaccard, 4),
        "top_confusions": [
            {"label": a, "predicted": b, "count": c}
            for (a, b), c in top_confusions
        ],
    }
    print(f"\nSUMMARY: {json.dumps(summary, indent=2)}")
    args.out.write_text(json.dumps(
        {"summary": summary, "results": results}, indent=2,
    ))
    print(f"detailed results: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
