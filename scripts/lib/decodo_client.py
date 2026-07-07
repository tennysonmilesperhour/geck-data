"""
Thin wrapper around the Decodo Web Scraping API.

Decodo charges per request and we are on a $19/mo plan with 19,000
Premium+JS requests/month, 10 req/s rate cap. The wrapper centralises:
  - the endpoint URL and required headers,
  - sensible defaults (15s timeout, headless=html, US geo),
  - automatic exponential backoff on 429 (rate limited) and 5xx,
  - one place to add structured logging so every script reports requests
    the same way.

Reference: https://docs.decodo.com/web-scraping-api
"""
from __future__ import annotations

import os
import random
import sys
import time
from dataclasses import dataclass
from typing import Any, Optional

import requests

DECODO_ENDPOINT = "https://scraper-api.decodo.com/v2/scrape"

# Hard floor between requests in seconds. The Decodo plan caps us at 10/s
# but in practice running closer to 5/s leaves headroom for retries and
# keeps us friendly with MorphMarket.
DEFAULT_MIN_REQUEST_INTERVAL_SECONDS = 0.25


@dataclass
class DecodoResponse:
    """What every scrape call returns. Keep it tiny on purpose."""

    status_code: int
    html: str
    url: str
    attempts: int


class DecodoClient:
    """Minimal Decodo wrapper. Reuses one requests.Session for keep-alive."""

    def __init__(
        self,
        auth: Optional[str] = None,
        min_request_interval: float = DEFAULT_MIN_REQUEST_INTERVAL_SECONDS,
        budget: Optional[Any] = None,
    ) -> None:
        # budget is a DecodoBudget (scripts/lib/budget.py) or None. When
        # set, every API attempt is counted against the monthly quota and
        # fetch() raises BudgetExceededError once the safety threshold is
        # crossed. Duck-typed so this module has no import dependency.
        self.budget = budget
        self.auth = auth or os.environ.get("DECODO_AUTH", "")
        if not self.auth:
            sys.exit(
                "ERROR: DECODO_AUTH is not set. It should be the full Basic "
                "auth header value, e.g. 'Basic dXNlcjpwYXNz'."
            )
        if not self.auth.lower().startswith("basic "):
            # Most users paste just the base64 part. Be forgiving.
            self.auth = f"Basic {self.auth}"

        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": self.auth,
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )
        self.min_request_interval = min_request_interval
        self._last_request_at: float = 0.0

    def _respect_rate_limit(self) -> None:
        """Sleep just enough to stay under our self-imposed rate cap."""
        elapsed = time.monotonic() - self._last_request_at
        wait = self.min_request_interval - elapsed
        if wait > 0:
            time.sleep(wait)
        self._last_request_at = time.monotonic()

    def fetch(
        self,
        url: str,
        *,
        headless: str = "html",
        geo: str = "United States",
        max_retries: int = 5,
        timeout_seconds: int = 60,
        proxy_pool: Optional[str] = None,
        browser_actions: Optional[list[dict[str, Any]]] = None,
    ) -> DecodoResponse:
        """Fetch one URL through Decodo with retries on 429 and 5xx.

        headless='html' triggers a real browser render (Premium+JS quota).
        For pages that work without JS, pass headless=None to save credits.

        proxy_pool='premium' upgrades to the premium proxy tier. Required
        for MorphMarket's listing grid; the default residential tier gets
        soft-blocked into returning page-1 content for every ?page=N URL.

        browser_actions is a list of post-render Decodo steps, e.g.:
            [{"type": "wait", "wait_time_s": 5},
             {"type": "scroll_to_bottom", "timeout_s": 10},
             {"type": "wait", "wait_time_s": 3}]
        Required for MorphMarket's grid so the React app has time to
        hydrate and lay out the full set of listings before Decodo
        snapshots the DOM.
        """
        payload: dict[str, Any] = {"url": url, "geo": geo}
        if headless:
            payload["headless"] = headless
        if proxy_pool:
            payload["proxy_pool"] = proxy_pool
        if browser_actions:
            payload["browser_actions"] = browser_actions

        attempt = 0
        last_exc: Optional[Exception] = None
        while attempt < max_retries:
            attempt += 1
            # Every attempt is one billed Decodo request, including
            # retries, so count before sending. check() raises
            # BudgetExceededError when the monthly threshold is hit.
            if self.budget is not None:
                self.budget.check()
                self.budget.record()
            self._respect_rate_limit()
            try:
                resp = self.session.post(
                    DECODO_ENDPOINT,
                    json=payload,
                    timeout=timeout_seconds,
                )
            except requests.RequestException as exc:
                last_exc = exc
                backoff = self._backoff(attempt)
                print(
                    f"[decodo] network error on attempt {attempt}/{max_retries} "
                    f"for {url}: {exc}; sleeping {backoff:.1f}s",
                    flush=True,
                )
                time.sleep(backoff)
                continue

            # 429 = rate limited. 5xx = transient Decodo failure. Both retry.
            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                backoff = self._backoff(attempt)
                print(
                    f"[decodo] {resp.status_code} on attempt "
                    f"{attempt}/{max_retries} for {url}; sleeping "
                    f"{backoff:.1f}s",
                    flush=True,
                )
                time.sleep(backoff)
                continue

            # Decodo wraps the target site's response in a JSON envelope:
            #   { "results": [ { "status_code": ..., "content": "..." } ] }
            if resp.status_code == 200:
                try:
                    body = resp.json()
                    results = body.get("results") or []
                    if not results:
                        last_exc = RuntimeError(
                            f"empty results array from Decodo for {url}"
                        )
                        time.sleep(self._backoff(attempt))
                        continue
                    first = results[0]
                    return DecodoResponse(
                        status_code=int(first.get("status_code", 200)),
                        html=str(first.get("content", "")),
                        url=url,
                        attempts=attempt,
                    )
                except (ValueError, KeyError) as exc:
                    last_exc = exc
                    time.sleep(self._backoff(attempt))
                    continue

            # Any other status: bail.
            return DecodoResponse(
                status_code=resp.status_code,
                html=resp.text,
                url=url,
                attempts=attempt,
            )

        raise RuntimeError(
            f"Decodo failed after {max_retries} attempts for {url}: {last_exc}"
        )

    @staticmethod
    def _backoff(attempt: int) -> float:
        """Exponential backoff with jitter. attempt=1 -> ~2s, 2 -> ~4s, ..."""
        return min(60.0, (2 ** attempt) + random.uniform(0, 1))
