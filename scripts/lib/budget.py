"""
Monthly request-budget guard for the Decodo scraper API.

Why this exists: in June 2026 the $19/mo plan's 19,000 request quota ran
out mid-month and every request started returning 429. Nothing in the
pipeline noticed; the scrapers kept firing hourly and burning their
GitHub Actions timeout for four weeks. This guard keeps our own count of
requests in the runtime_config table (key like decodo_requests_202607)
and hard-stops new requests once we cross a safety threshold, so a
retry storm or a MorphMarket layout change can never silently drain the
whole month's quota.

The count is best-effort, not exact: concurrent runs (the hourly
listings job overlapping a weekly sellers job) each flush their own
in-memory tally, so simultaneous writers can undercount slightly. That
is fine; the guard is a circuit breaker, not a billing system. Decodo's
own dashboard is the source of truth for actual usage.

Env overrides:
  DECODO_MONTHLY_QUOTA          default 19000
  DECODO_BUDGET_STOP_FRACTION   default 0.9 (stop at 90% of quota)
"""
from __future__ import annotations

import datetime as dt
import os
from typing import Optional

DEFAULT_MONTHLY_QUOTA = 19_000
DEFAULT_STOP_FRACTION = 0.9

# Persist the tally every N recorded requests. Each flush also writes a
# runtime_config_history row via the audit trigger, so keep this large
# enough that history stays readable (19k/50 = ~380 rows a month, max).
FLUSH_EVERY = 50


class BudgetExceededError(RuntimeError):
    """Raised when the month's Decodo request budget is used up."""


class DecodoBudget:
    """Tracks Decodo requests this month in runtime_config.

    Usage:
        budget = DecodoBudget(supabase)
        decodo = DecodoClient(budget=budget)
        try:
            ... scrape ...
        finally:
            budget.flush()
    """

    def __init__(
        self,
        supabase,
        monthly_quota: Optional[int] = None,
        stop_fraction: Optional[float] = None,
    ) -> None:
        self.supabase = supabase
        self.monthly_quota = int(
            monthly_quota
            or os.environ.get("DECODO_MONTHLY_QUOTA")
            or DEFAULT_MONTHLY_QUOTA
        )
        self.stop_fraction = float(
            stop_fraction
            or os.environ.get("DECODO_BUDGET_STOP_FRACTION")
            or DEFAULT_STOP_FRACTION
        )
        month = dt.datetime.now(dt.timezone.utc).strftime("%Y%m")
        self.key = f"decodo_requests_{month}"
        self.spent = self._load()
        self._unflushed = 0

    @property
    def stop_at(self) -> int:
        return int(self.monthly_quota * self.stop_fraction)

    def _load(self) -> int:
        """Read this month's tally. A broken read fails open (returns 0):
        a config hiccup must not stop scraping; the Decodo-side 429s and
        the fail-fast guard still backstop a true quota blowout."""
        try:
            rows = (
                self.supabase.table("runtime_config")
                .select("value")
                .eq("key", self.key)
                .execute()
                .data
                or []
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[budget] WARN could not read {self.key}: {exc}", flush=True)
            return 0
        if rows:
            try:
                return int(rows[0]["value"])
            except (TypeError, ValueError):
                return 0
        return 0

    def check(self) -> None:
        """Raise BudgetExceededError if the safety threshold is crossed."""
        if self.spent >= self.stop_at:
            raise BudgetExceededError(
                f"Decodo budget stop: {self.spent} requests recorded for "
                f"{self.key}; the stop threshold is {self.stop_at} "
                f"({int(self.stop_fraction * 100)}% of the {self.monthly_quota} "
                "monthly quota). Scraping pauses until the month rolls over. "
                "If the plan was upgraded, set DECODO_MONTHLY_QUOTA (or edit "
                "the runtime_config row) to match."
            )

    def record(self, n: int = 1) -> None:
        """Count n requests and persist the tally every FLUSH_EVERY."""
        self.spent += n
        self._unflushed += n
        if self._unflushed >= FLUSH_EVERY:
            self.flush()

    def flush(self) -> None:
        """Persist the in-memory tally to runtime_config. Safe to call
        repeatedly; a failed write logs a warning and keeps the tally in
        memory for the next attempt."""
        if self._unflushed == 0:
            return
        try:
            self.supabase.table("runtime_config").upsert(
                {
                    "key": self.key,
                    "value": self.spent,
                    "value_kind": "integer",
                    "description": (
                        "Decodo requests recorded this month by the scraper "
                        "budget guard (best-effort count, see scripts/lib/budget.py)."
                    ),
                    "updated_by": "decodo_budget_guard",
                },
                on_conflict="key",
            ).execute()
            self._unflushed = 0
        except Exception as exc:  # noqa: BLE001
            print(
                f"[budget] WARN could not persist request count: {exc}",
                flush=True,
            )
