"""Rendered MorphMarket pages using the catalog's browser and retry policy.

Use this client on the thread that created it. Playwright's synchronous
browser cannot be shared between the old Decodo worker threads.
"""
from typing import NamedTuple

from scrape_listings_api import (
    CATALOG_DETAIL_RETRY_BACKOFF_S,
    MorphMarketFetchError,
    MorphMarketFetcher,
    fetch_with_retries,
)


class HtmlResponse(NamedTuple):
    status_code: int
    html: str


class MorphMarketHtmlClient:
    def __init__(self) -> None:
        self.fetcher = MorphMarketFetcher()

    def fetch(self, url: str) -> HtmlResponse:
        try:
            html = fetch_with_retries(
                lambda: self.fetcher.fetch_rendered_text(url),
                what="rendered page",
                fetcher=self.fetcher,
                backoffs=CATALOG_DETAIL_RETRY_BACKOFF_S,
            )
        except MorphMarketFetchError as exc:
            # Only a confirmed terminal HTTP response may mark a listing gone.
            # A transport error must never inherit another request's 404.
            if not exc.retryable and self.fetcher.last_status in (404, 410):
                return HtmlResponse(self.fetcher.last_status, "")
            raise
        return HtmlResponse(200, html)

    def close(self) -> None:
        self.fetcher.close()
