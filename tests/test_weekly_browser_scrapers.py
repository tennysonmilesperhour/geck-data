from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import scrape_details as details
import scrape_sellers as sellers
import scrape_listings_api as api
from lib.morphmarket_html import HtmlResponse, MorphMarketHtmlClient


class BrowserHtmlTests(unittest.TestCase):
    def client(self):
        client = MorphMarketHtmlClient.__new__(MorphMarketHtmlClient)
        client.fetcher = mock.Mock()
        return client

    def test_transient_error_recovers_with_detail_waits(self):
        client = self.client()
        client.fetcher.fetch_rendered_text.side_effect = [
            api.MorphMarketFetchError("tunnel failed"), "<html>store</html>"
        ]
        with patch.object(api.time, "sleep") as sleep:
            self.assertEqual(client.fetch("https://example.test"), HtmlResponse(200, "<html>store</html>"))
        sleep.assert_called_once_with(5)
        client.fetcher.restart.assert_called_once_with()

    def test_only_confirmed_404_or_410_becomes_gone_response(self):
        for status in (404, 410):
            with self.subTest(status=status):
                client = self.client()
                client.fetcher.last_status = status
                client.fetcher.fetch_rendered_text.side_effect = api.MorphMarketFetchError("gone", retryable=False)
                self.assertEqual(client.fetch("https://example.test"), HtmlResponse(status, ""))
                client.fetcher.restart.assert_not_called()

    def test_transport_error_cannot_become_gone_even_with_stale_status(self):
        client = self.client()
        client.fetcher.last_status = 404
        client.fetcher.fetch_rendered_text.side_effect = api.MorphMarketFetchError("tunnel")
        with patch.object(api.time, "sleep"), self.assertRaises(api.MorphMarketFetchError):
            client.fetch("https://example.test")

    def test_access_denied_stops_immediately(self):
        client = self.client()
        client.fetcher.last_status = 403
        client.fetcher.fetch_rendered_text.side_effect = api.MorphMarketAccessDeniedError("blocked", retryable=False)
        with self.assertRaises(api.MorphMarketAccessDeniedError):
            client.fetch("https://example.test")
        client.fetcher.restart.assert_not_called()

    def test_render_reads_hydrated_dom_and_sanitizes_browser_errors(self):
        fetcher = api.MorphMarketFetcher.__new__(api.MorphMarketFetcher)
        fetcher.proxy_url = ""
        fetcher._page = mock.Mock()
        fetcher._page.content.return_value = "hydrated"
        with patch.object(fetcher, "_fetch_bytes", return_value=b"initial"):
            self.assertEqual(fetcher.fetch_rendered_text("url"), "hydrated")
            fetcher._page.wait_for_timeout.assert_called_once_with(5000)
            fetcher._page.content.side_effect = api.PlaywrightError("secret")
            with patch.object(fetcher, "_safe_error", return_value="redacted"):
                with self.assertRaisesRegex(api.MorphMarketFetchError, "redacted"):
                    fetcher.fetch_rendered_text("url")


class WeeklyFetchTests(unittest.TestCase):
    def test_detail_parses_browser_html(self):
        client = mock.Mock()
        client.fetch.return_value = HtmlResponse(200, '''<script type="application/ld+json">
        {"@type":"Product","name":"Gecko","offers":{"price":"125","priceCurrency":"USD"}}
        </script>''')
        with patch.object(details.time, "sleep"):
            result = details.fetch_listing_detail(client, {"listing_id": "1", "listing_url": "url"})
        self.assertEqual(result.action, "upsert")
        self.assertEqual(result.row["price"], 125)
        self.assertEqual(result.row["listing_url"], "url")

    def test_gone_detail_deactivates_but_gone_store_skips(self):
        for status in (404, 410):
            with self.subTest(status=status), patch.object(details.time, "sleep"):
                client = mock.Mock()
                client.fetch.return_value = HtmlResponse(status, "")
                self.assertEqual(details.fetch_listing_detail(client, {"listing_id": "1", "listing_url": "url"}).action, "deactivate")
                self.assertEqual(sellers.fetch_seller(client, "store").action, "skip")

    def test_store_metadata_parses_and_challenge_title_does_not(self):
        client = mock.Mock()
        client.fetch.return_value = HtmlResponse(200, '''<title>Test Store - MorphMarket</title>
        <meta name="description" content="Test Store on MorphMarket is owned by Test Owner and located in Denver, CO.">''')
        with patch.object(details.time, "sleep"):
            result = sellers.fetch_seller(client, "store")
            self.assertEqual(result.action, "upsert")
            self.assertEqual(result.row["store_name"], "Test Store")
            self.assertEqual(result.row["location_raw"], "Denver, CO")
            client.fetch.return_value = HtmlResponse(200, "<title>Just a moment...</title>")
            self.assertEqual(sellers.fetch_seller(client, "store").action, "skip")


class WeeklyRunTests(unittest.TestCase):
    def run_scraper(self, module, *, error=None, parse_skip=False):
        sb = mock.Mock()
        todo = [{"listing_id": str(i), "listing_url": "url"} for i in range(10)]
        sb.rpc.return_value.execute.return_value.data = todo
        sb.table.return_value.select.return_value.execute.return_value.data = [
            {"seller_slug": str(i)} for i in range(10)
        ]
        is_detail = module is details
        fetch_name = "fetch_listing_detail" if is_detail else "fetch_seller"
        cap = "MAX_LISTINGS" if is_detail else "MAX_SELLERS"
        row = {"listing_id": "1"} if is_detail else {"seller_slug": "1"}
        result = module.FetchResult("skip" if parse_skip else "upsert", "1", row=None if parse_skip else row)
        with patch.dict(os.environ, {cap: "8" if error else "2"}), \
             patch.object(module, "get_supabase", return_value=sb), \
             patch.object(module, "start_scrape_run", return_value=7), \
             patch.object(module, "finalise_scrape_run") as finalise, \
             patch.object(module, "MorphMarketHtmlClient") as client, \
             patch.object(module, fetch_name, side_effect=error, return_value=result) as fetch:
            code = module.main()
        client.return_value.close.assert_called_once_with()
        return code, finalise.call_args.kwargs, fetch, sb

    def test_capped_runs_write_only_requested_records_and_close_browser(self):
        for module in (details, sellers):
            with self.subTest(module=module):
                code, final, fetch, sb = self.run_scraper(module)
                self.assertEqual(code, 0)
                self.assertEqual(final["succeeded"], 2)
                self.assertEqual(fetch.call_count, 2)
                self.assertEqual(sb.table.return_value.upsert.call_count, 2)

    def test_five_fetch_failures_stop_without_processing_rest(self):
        for module in (details, sellers):
            with self.subTest(module=module):
                code, final, fetch, sb = self.run_scraper(module, error=api.MorphMarketFetchError("tunnel"))
                self.assertEqual(code, 1)
                self.assertEqual(final["status"], "failed")
                self.assertEqual(fetch.call_count, 5)
                sb.table.return_value.upsert.assert_not_called()

    def test_access_denied_aborts_first_record(self):
        for module in (details, sellers):
            with self.subTest(module=module):
                code, final, fetch, sb = self.run_scraper(module, error=api.MorphMarketAccessDeniedError("blocked"))
                self.assertEqual(code, 1)
                self.assertEqual(fetch.call_count, 1)
                sb.table.return_value.upsert.assert_not_called()

    def test_unparseable_recovery_run_fails_instead_of_going_green(self):
        for module in (details, sellers):
            with self.subTest(module=module):
                code, final, fetch, sb = self.run_scraper(module, parse_skip=True)
                self.assertEqual(code, 1)
                self.assertEqual(final["status"], "failed")
                sb.table.return_value.upsert.assert_not_called()
