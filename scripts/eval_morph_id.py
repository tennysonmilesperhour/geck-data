"""
Measure the recognize-gecko-morph edge function's accuracy against
geck-data's wild MorphMarket corpus, persist the run to
public.morph_eval_runs, and dump per-row JSON for forensics.

For each image in the requested split:
  - call the geck-inspect edge function
  - compare its primary_morph + genetic_traits + base_color to the
    seller-reported labels (canonical ids via v_morph_training_canonical)
  - track per-trait confusion

Top-line metrics get persisted to public.morph_eval_runs so the
/data-admin/training/evals dashboard can chart progress over time.

Seller labels are noisy ground truth. Watch the *delta* between runs as
the prompt / model / few-shot bank changes — that's the signal.

Env vars consumed:
  SUPABASE_URL                     (geck-data)
  SUPABASE_SERVICE_ROLE_KEY        (geck-data — writes to morph_eval_runs)
  GECK_INSPECT_FUNCTION_URL        e.g. https://<ref>.supabase.co/functions/v1
  GECK_INSPECT_ANON_KEY            anon JWT, for invoking the edge function
  EVAL_DAILY_CAP_CALLS             default 300 — total images eval'd across
                                   all morph_eval_runs today (UTC). New run
                                   refuses to start if today's total would
                                   exceed this cap. Set to 0 to disable.

Usage:
  python scripts/eval_morph_id.py                         # 25-image haiku eval (default)
  python scripts/eval_morph_id.py --model sonnet --limit 100 \
    --notes "blessed v6 benchmark" --yes                  # full benchmark
  python scripts/eval_morph_id.py --split test --limit 50 # quick on test split

Spend-bounding behavior (added after 2026-05-15 incident):
  - Default --model is haiku (cheapest); pass --model sonnet for benchmarks.
  - Default --limit is 25 (was 200) so a no-arg invocation is cheap.
  - On 429 from the edge function, the loop aborts immediately so we
    don't keep accumulating rate-limit hits.
  - On startup we sum today's eval_set_size across morph_eval_runs and
    refuse to start if today + this run would exceed EVAL_DAILY_CAP_CALLS.
  - We print the call count + estimated cost and wait for stdin
    confirmation unless --yes is passed.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional

import requests

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from lib.supabase_client import get_supabase  # noqa: E402

PAGE_SIZE = 200

# Default daily ceiling for total images sent to the edge function across
# all eval runs in a UTC day. Tuned to ~$1/day worst-case at Sonnet rates
# (100 calls × ~$0.01 per call) or ~5x that at Haiku rates with a budget
# headroom. Override with EVAL_DAILY_CAP_CALLS env var; set to 0 to disable.
DEFAULT_DAILY_CAP_CALLS = 300

# Model aliases — keep them short so --model haiku / sonnet / opus works.
MODEL_ALIASES = {
    "haiku":  "claude-haiku-4-5",
    "sonnet": "claude-sonnet-4-6",
    "opus":   "claude-opus-4-7",
}

# Rough per-call cost estimates for the confirmation prompt. Numbers are
# pessimistic (assume max_tokens output) so the displayed cost is the
# upper bound, not the average. Adjust if the per-call shape changes.
PER_CALL_COST_USD = {
    "claude-haiku-4-5":   0.005,
    "claude-sonnet-4-6":  0.020,
    "claude-opus-4-7":    0.080,
}


class RateLimited(Exception):
    """Raised when the edge function reports a 429 from Anthropic. The
    main loop catches this and aborts the eval immediately so we don't
    accumulate further rate-limit hits."""


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--split", choices=("train", "val", "test"), default="test")
    p.add_argument("--limit", type=int, default=25,
                   help="Cap on images to eval (default 25; raise explicitly for benchmarks).")
    p.add_argument("--model", type=str, default="haiku",
                   help="Model alias (haiku|sonnet|opus) or raw model id. "
                        "Default haiku — switch to sonnet only for blessed benchmark runs.")
    p.add_argument("--out", type=Path, default=Path("./morph_id_eval.json"),
                   help="Where to write per-row results for forensics")
    p.add_argument("--qps", type=float, default=1.0,
                   help="Max queries per second (rate limit)")
    p.add_argument("--notes", type=str, default=None,
                   help="Optional human note (e.g. 'after prompt tweak v2')")
    p.add_argument("--no-persist", action="store_true",
                   help="Skip writing the summary to public.morph_eval_runs")
    p.add_argument("--yes", "-y", action="store_true",
                   help="Skip the call-count confirmation prompt.")
    return p.parse_args()


def resolve_model(raw: str) -> str:
    """Translate --model haiku|sonnet|opus into the full model id, or
    pass through a raw id verbatim. Unknown aliases raise."""
    if raw in MODEL_ALIASES:
        return MODEL_ALIASES[raw]
    if raw.startswith("claude-"):
        return raw
    raise ValueError(
        f"Unknown --model value '{raw}'. Use one of: "
        f"{sorted(MODEL_ALIASES)} or a full model id like claude-sonnet-4-6."
    )


def todays_eval_call_count(supabase) -> int:
    """Sum of eval_set_size across morph_eval_runs that *started* today
    (UTC). Used to enforce EVAL_DAILY_CAP_CALLS. We use started_at rather
    than finished_at so a long-running eval in flight still counts."""
    today_utc_start = dt.datetime.now(dt.timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ).isoformat()
    try:
        res = supabase.table("morph_eval_runs").select(
            "eval_set_size"
        ).gte("started_at", today_utc_start).execute()
        return sum(int(r.get("eval_set_size") or 0) for r in (res.data or []))
    except Exception as exc:  # noqa: BLE001
        # Don't block the run on a connection blip; surface the warning
        # and assume zero so the user is at most ONE budget over.
        print(f"WARN: could not check today's eval cap; assuming 0 ({exc})")
        return 0


def call_recognize(image_url: str, fn_url: str, anon_key: str,
                   model: str) -> dict[str, Any]:
    res = requests.post(
        f"{fn_url}/recognize-gecko-morph",
        headers={
            "Authorization": f"Bearer {anon_key}",
            "Content-Type": "application/json",
        },
        json={"imageUrl": image_url, "model": model},
        timeout=60,
    )
    # The edge function returns 500 with the Anthropic error message in
    # the body for upstream failures. Sniff for 429 / rate-limit text so
    # we can abort the loop instead of grinding more requests through.
    body_text = res.text[:400] if not res.ok else ""
    if res.status_code == 429 or (
        not res.ok and ("429" in body_text or "rate_limit" in body_text.lower()
                        or "rate-limit" in body_text.lower())
    ):
        raise RateLimited(f"upstream rate limit hit (status={res.status_code}): {body_text}")
    res.raise_for_status()
    body = res.json()
    if not body.get("success"):
        # Edge function may also surface rate-limit info in the error
        # JSON. Translate to RateLimited so the abort path triggers.
        err = str(body)[:300]
        if "429" in err or "rate_limit" in err.lower():
            raise RateLimited(f"upstream rate limit hit in body: {err}")
        raise RuntimeError(f"edge function error: {err}")
    return body["analysis"]


def jaccard(a: list[str], b: list[str]) -> float:
    sa, sb = set(a or []), set(b or [])
    if not sa and not sb:
        return 1.0
    return len(sa & sb) / max(1, len(sa | sb))


def compute_per_trait_metrics(results: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Per primary_morph: precision, recall, F1, support."""
    label_counts = collections.Counter()   # support per truth label
    pred_counts  = collections.Counter()   # predictions per label
    tp_counts    = collections.Counter()   # true positives per label

    for r in results:
        if "prediction" not in r:
            continue
        truth = r["label"]["primary_morph"]
        pred  = r["prediction"].get("primary_morph")
        if truth: label_counts[truth] += 1
        if pred:  pred_counts[pred]   += 1
        if truth and truth == pred:
            tp_counts[truth] += 1

    metrics: dict[str, dict[str, Any]] = {}
    for lab in set(label_counts) | set(pred_counts):
        tp = tp_counts[lab]
        precision = tp / pred_counts[lab] if pred_counts[lab] else 0.0
        recall    = tp / label_counts[lab] if label_counts[lab] else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
        metrics[lab] = {
            "precision": round(precision, 4),
            "recall":    round(recall, 4),
            "f1":        round(f1, 4),
            "support":   int(label_counts[lab]),
            "predicted": int(pred_counts[lab]),
        }
    return metrics


def prompt_fingerprint(args: argparse.Namespace) -> str:
    bits = "|".join([args.split, str(args.limit), str(args.qps)])
    return hashlib.sha1(bits.encode()).hexdigest()[:10]


def _load_dotenv_for_eval() -> None:
    """Pull .env.local into os.environ before we read GECK_INSPECT_* vars.

    The eval script needs these BEFORE get_supabase() runs, so we can't
    rely on supabase_client._load_dotenv_if_present which runs later.
    """
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return
    repo_root = Path(__file__).resolve().parents[1]
    for candidate in (repo_root / ".env.local", repo_root / ".env"):
        if candidate.exists():
            load_dotenv(candidate, override=False)
            return


def main() -> int:
    args = parse_args()
    _load_dotenv_for_eval()

    fn_url = os.environ.get("GECK_INSPECT_FUNCTION_URL")
    anon_key = os.environ.get("GECK_INSPECT_ANON_KEY")
    if not fn_url or not anon_key:
        sys.exit(
            "ERROR: set GECK_INSPECT_FUNCTION_URL and GECK_INSPECT_ANON_KEY."
        )

    try:
        requested_model = resolve_model(args.model)
    except ValueError as exc:
        sys.exit(f"ERROR: {exc}")

    supabase = get_supabase()

    # Daily-cap check. Sum of eval_set_size for runs started today (UTC)
    # plus this run's --limit must stay under EVAL_DAILY_CAP_CALLS.
    daily_cap = int(os.environ.get(
        "EVAL_DAILY_CAP_CALLS", str(DEFAULT_DAILY_CAP_CALLS),
    ))
    if daily_cap > 0:
        today_used = todays_eval_call_count(supabase)
        projected = today_used + args.limit
        if projected > daily_cap:
            sys.exit(
                f"ERROR: today's eval calls would total {projected} "
                f"({today_used} already + {args.limit} this run), exceeding "
                f"EVAL_DAILY_CAP_CALLS={daily_cap}. Wait until tomorrow (UTC) "
                f"or raise the cap with `EVAL_DAILY_CAP_CALLS=N python ...`."
            )
        print(f"daily cap: {today_used}/{daily_cap} used today, "
              f"this run will use up to {args.limit} more.")

    # Confirmation prompt with cost estimate. Bypass with --yes / -y.
    per_call = PER_CALL_COST_USD.get(requested_model, 0.02)
    est_cost = per_call * args.limit
    if not args.yes:
        prompt = (
            f"\nAbout to run eval with model={requested_model}, "
            f"split={args.split}, up to {args.limit} images.\n"
            f"Estimated upper-bound cost: ${est_cost:.2f} "
            f"(@ ~${per_call:.3f}/call).\n"
            f"Proceed? [y/N] "
        )
        try:
            answer = input(prompt).strip().lower()
        except EOFError:
            answer = ""
        if answer not in {"y", "yes"}:
            print("aborted.")
            return 1

    # Pull canonical rows from the canonical view.
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        res = supabase.table("v_morph_training_canonical").select(
            "image_url,primary_morph,genetic_traits,base_color,split,listing_id"
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
    print(f"eval set: {len(rows)} images (split={args.split})")

    # Open the eval-run record so the dashboard sees this run in flight.
    run_id: Optional[int] = None
    if not args.no_persist:
        try:
            ins = supabase.table("morph_eval_runs").insert({
                "status":             "running",
                "split":              args.split,
                "eval_set_size":      len(rows),
                "triggered_by":       os.environ.get("TRIGGERED_BY", "manual"),
                "notes":              args.notes,
                "prompt_fingerprint": prompt_fingerprint(args),
            }).execute()
            run_id = int(ins.data[0]["id"])
            print(f"opened morph_eval_runs id={run_id}")
        except Exception as exc:  # noqa: BLE001
            print(f"WARN: could not open eval-run record: {exc}")

    results: list[dict[str, Any]] = []
    correct_primary = 0
    correct_base_color = 0
    base_color_n = 0
    interval = 1.0 / max(args.qps, 0.01)
    last_t = 0.0
    model = None

    aborted_on_rate_limit = False
    try:
        for i, row in enumerate(rows):
            wait = interval - (time.time() - last_t)
            if wait > 0:
                time.sleep(wait)
            last_t = time.time()
            url = row["image_url"]
            try:
                analysis = call_recognize(url, fn_url, anon_key, requested_model)
            except RateLimited as exc:
                # Stop the loop. Burning the rest of the eval set just
                # generates more 429s and inflates the user's rate-limit
                # hit count without producing any useful eval data.
                print(f"  [{i+1}/{len(rows)}] ABORT — rate limit hit: {str(exc)[:120]}")
                results.append({"image_url": url, "error": str(exc)[:160], "label": row,
                                "aborted": True})
                aborted_on_rate_limit = True
                break
            except Exception as exc:  # noqa: BLE001
                print(f"  [{i+1}/{len(rows)}] FAIL {url}: {str(exc)[:80]}")
                results.append({"image_url": url, "error": str(exc)[:120], "label": row})
                continue

            model = analysis.get("model", model)
            pred = analysis.get("primary_morph")
            truth = row["primary_morph"]
            match = pred == truth
            if match:
                correct_primary += 1
            if row.get("base_color"):
                base_color_n += 1
                if analysis.get("base_color") == row["base_color"]:
                    correct_base_color += 1
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

        # ---- Aggregate ----
        n_evaluated = sum(1 for r in results if "prediction" in r)
        primary_acc = correct_primary / max(1, n_evaluated)
        avg_jaccard = (
            sum(r.get("genetic_jaccard", 0) for r in results if "prediction" in r)
            / max(1, n_evaluated)
        )
        bc_acc = correct_base_color / max(1, base_color_n) if base_color_n else None

        confusion = collections.Counter()
        for r in results:
            if "prediction" not in r:
                continue
            confusion[(r["label"]["primary_morph"],
                       r["prediction"].get("primary_morph"))] += 1
        top_confusions = [
            {"label": a, "predicted": b, "count": c}
            for (a, b), c in sorted(
                ((k, v) for k, v in confusion.items() if k[0] != k[1]),
                key=lambda kv: -kv[1],
            )[:15]
        ]

        per_trait = compute_per_trait_metrics(results)

        summary = {
            "eval_set_size":                n_evaluated,
            "primary_morph_top1_accuracy":  round(primary_acc, 4),
            "genetic_trait_jaccard_avg":    round(avg_jaccard, 4),
            "base_color_accuracy":          round(bc_acc, 4) if bc_acc is not None else None,
            "top_confusions":               top_confusions,
            "model":                        model,
        }
        print(f"\nSUMMARY: {json.dumps(summary, indent=2)}")

        args.out.write_text(json.dumps(
            {"summary": summary, "per_trait_metrics": per_trait, "results": results},
            indent=2,
        ))
        print(f"detailed results: {args.out}")

        if run_id is not None:
            try:
                supabase.table("morph_eval_runs").update({
                    "status":                      "failed" if aborted_on_rate_limit else "success",
                    "finished_at":                 dt.datetime.now(dt.timezone.utc).isoformat(),
                    "model":                       model,
                    "primary_morph_top1_accuracy": round(primary_acc, 4),
                    "genetic_jaccard_avg":         round(avg_jaccard, 4),
                    "base_color_accuracy":         round(bc_acc, 4) if bc_acc is not None else None,
                    "per_trait_metrics":           per_trait,
                    "top_confusions":              top_confusions,
                    "error_message":               (
                        f"aborted on upstream rate limit after {n_evaluated} of {len(rows)} images"
                        if aborted_on_rate_limit else None
                    ),
                }).eq("id", run_id).execute()
                print(f"persisted morph_eval_runs id={run_id}")
            except Exception as exc:  # noqa: BLE001
                print(f"WARN: could not persist eval-run summary: {exc}")
        return 2 if aborted_on_rate_limit else 0
    except Exception as exc:
        if run_id is not None:
            try:
                supabase.table("morph_eval_runs").update({
                    "status":         "failed",
                    "finished_at":    dt.datetime.now(dt.timezone.utc).isoformat(),
                    "error_message":  f"{type(exc).__name__}: {exc}",
                }).eq("id", run_id).execute()
            except Exception:  # noqa: BLE001
                pass
        raise


if __name__ == "__main__":
    sys.exit(main())
