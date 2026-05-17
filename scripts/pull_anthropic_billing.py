"""
Pull Anthropic's actual cost report and upsert into anthropic_billing_daily.

The /data-admin/control "Spend (7d)" panel pairs this with the estimated
cost computed from model_invocations.input_tokens/output_tokens so we can
see drift between what we *thought* we spent (per-call price table) and
what Anthropic *actually* billed (their cost_report endpoint).

Env vars:
  SUPABASE_URL                geck-data project URL
  SUPABASE_SERVICE_ROLE_KEY   geck-data service role
  ANTHROPIC_ADMIN_API_KEY     org-admin-scoped key (NOT the usual
                              ANTHROPIC_API_KEY used by the edge function).
                              Generate one in the Anthropic Console under
                              API Keys -> Admin keys.

Usage:
  python scripts/pull_anthropic_billing.py              # last 7 days
  python scripts/pull_anthropic_billing.py --days 30    # last 30 days
  python scripts/pull_anthropic_billing.py --dry-run    # fetch + print, don't upsert

Cron suggestion (.github/workflows/pull-anthropic-billing-daily.yml):
  Run daily at 09:30 UTC, after midnight in every US tz so the previous
  UTC day is complete on Anthropic's side.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import requests

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from lib.supabase_client import get_supabase  # noqa: E402

ENDPOINT = "https://api.anthropic.com/v1/organizations/cost_report"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--days", type=int, default=7,
                   help="How many days back to pull (default 7, max 31).")
    p.add_argument("--dry-run", action="store_true",
                   help="Fetch and aggregate but skip the Supabase upsert.")
    return p.parse_args()


def fetch_cost_report(admin_key: str, days: int) -> list[dict[str, Any]]:
    """Pages through /v1/organizations/cost_report, returns flat list of
    bucket dicts in oldest-first order."""
    starting_at = (dt.datetime.now(dt.timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0,
    ) - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    buckets: list[dict[str, Any]] = []
    page: str | None = None
    while True:
        params: dict[str, Any] = {
            "starting_at":  starting_at,
            "bucket_width": "1d",
            "group_by[]":   "description",
            "limit":        31,
        }
        if page:
            params["page"] = page
        res = requests.get(
            ENDPOINT,
            params=params,
            headers={
                "anthropic-version": "2023-06-01",
                "X-Api-Key":         admin_key,
            },
            timeout=30,
        )
        if res.status_code == 401:
            sys.exit(
                "ERROR: 401 from Anthropic Admin API. Confirm "
                "ANTHROPIC_ADMIN_API_KEY is an Admin-scoped key, not the "
                "usual ANTHROPIC_API_KEY (those start with `sk-ant-api`; "
                "admin keys start with `sk-ant-admin`)."
            )
        if res.status_code == 404:
            sys.exit(
                "ERROR: 404 from Anthropic Admin API. The cost_report "
                "endpoint may not be enabled for this organization. Check "
                "the API key's scope in the Anthropic Console."
            )
        res.raise_for_status()
        body = res.json()
        buckets.extend(body.get("data") or [])
        if not body.get("has_more"):
            break
        page = body.get("next_page")
        if not page:
            break
    return buckets


def aggregate(buckets: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Roll up the (potentially many) result rows per bucket into a
    single per-day record."""
    out: dict[str, dict[str, Any]] = {}
    for bucket in buckets:
        start = bucket.get("starting_at")
        if not start:
            continue
        day = start.split("T")[0]
        by_model: dict[str, float] = defaultdict(float)
        by_token_type: dict[str, float] = defaultdict(float)
        total = 0.0
        for r in bucket.get("results") or []:
            # `amount` is cents as a decimal string per the API docs.
            try:
                cents = float(r.get("amount", "0"))
            except (TypeError, ValueError):
                continue
            total += cents
            model = r.get("model") or "unknown"
            token_type = r.get("token_type") or r.get("cost_type") or "other"
            by_model[model] += cents
            by_token_type[token_type] += cents
        out[day] = {
            "day":           day,
            "cost_cents":    round(total, 4),
            "by_model":      {k: round(v, 4) for k, v in by_model.items()},
            "by_token_type": {k: round(v, 4) for k, v in by_token_type.items()},
            "raw":           bucket,
        }
    return out


def main() -> int:
    args = parse_args()
    if args.days < 1 or args.days > 31:
        sys.exit("ERROR: --days must be between 1 and 31 (API max).")

    admin_key = os.environ.get("ANTHROPIC_ADMIN_API_KEY")
    if not admin_key:
        sys.exit(
            "ERROR: set ANTHROPIC_ADMIN_API_KEY. Generate an Admin key in the "
            "Anthropic Console -> Settings -> API Keys -> Admin keys. Do NOT "
            "reuse the runtime ANTHROPIC_API_KEY here; it lacks the org scope."
        )

    buckets = fetch_cost_report(admin_key, args.days)
    print(f"fetched {len(buckets)} daily buckets from cost_report.")
    rolled = aggregate(buckets)
    if not rolled:
        print("no cost data returned. Nothing to upsert.")
        return 0

    if args.dry_run:
        print(json.dumps(rolled, indent=2)[:4000])
        return 0

    supabase = get_supabase()
    upserts = [
        {
            "day":           row["day"],
            "cost_cents":    row["cost_cents"],
            "by_model":      row["by_model"],
            "by_token_type": row["by_token_type"],
            "raw":           row["raw"],
            "fetched_at":    dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        for row in rolled.values()
    ]
    res = supabase.table("anthropic_billing_daily").upsert(
        upserts, on_conflict="day",
    ).execute()
    written = len(res.data or [])
    print(f"upserted {written} days into anthropic_billing_daily.")
    for row in sorted(rolled.values(), key=lambda r: r["day"]):
        print(f"  {row['day']}: ${row['cost_cents'] / 100:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
