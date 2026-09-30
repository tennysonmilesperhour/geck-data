from __future__ import annotations

import datetime as dt
import sys
import unittest
from pathlib import Path
import os
from unittest import mock
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import scrape_listings_api as api  # noqa: E402


class CrestedFilterTests(unittest.TestCase):
    def test_keeps_only_supported_crested_signals(self) -> None:
        keep = (
            {"category_name": "Crested Gecko"},
            {"category_scientific_name": "Correlophus ciliatus"},
            {
                "path": (
                    "https://www.morphmarket.com/us/c/reptiles/lizards/"
                    "crested-geckos/123"
                )
            },
            {
                "category": {
                    "name": "Crested Geckos",
                    "scientific_name": "Correlophus ciliatus",
                }
            },
        )
        for item in keep:
            with self.subTest(item=item):
                self.assertTrue(api.is_crested(item))

        drop = (
            {"category_name": "Gargoyle Gecko"},
            {"category_scientific_name": "Rhacodactylus auriculatus"},
            {
                "path": (
                    "https://www.morphmarket.com/us/c/reptiles/lizards/"
                    "leopard-geckos/456"
                )
            },
            {"title": "Crested Gecko Supplies"},
        )
        for item in drop:
            with self.subTest(item=item):
                self.assertFalse(api.is_crested(item))


class SellerIdentityTests(unittest.TestCase):
    def test_detail_row_prefers_owner_slug_and_name(self) -> None:
        detail = {
            "id": 123,
            "owner": {
                "id": "real_store_slug",
                "person_name": "Real Store Name",
            },
        }
        row = api.detail_to_listing_row(
            detail,
            dt.datetime(2026, 8, 31, tzinfo=dt.timezone.utc),
        )
        self.assertEqual(row["seller_slug"], "real_store_slug")
        self.assertEqual(row["seller_name"], "Real Store Name")
        self.assertNotIn("first_seen_at", row)

    def test_detail_row_falls_back_to_rendered_store_anchor(self) -> None:
        detail = {"id": 456, "owner": {}}
        rendered_html = """
            <html><body>
              <a class="store" href="/stores/rendered_store/">
                <span>Rendered Store Name</span>
              </a>
            </body></html>
        """
        row = api.detail_to_listing_row(
            detail,
            dt.datetime(2026, 8, 31, tzinfo=dt.timezone.utc),
            rendered_html=rendered_html,
        )
        self.assertEqual(row["seller_slug"], "rendered_store")
        self.assertEqual(row["seller_name"], "Rendered Store Name")


class CatalogCompletionGuardTests(unittest.TestCase):
    @patch.object(api, "mark_unseen_after_complete_catalog")
    def test_incomplete_walk_never_calls_mark_unseen(self, mark_unseen) -> None:
        incomplete_states = (
            api.catalog_walk_complete(
                aborted=True,
                saw_natural_end=True,
                hit_page_cap=False,
            ),
            api.catalog_walk_complete(
                aborted=False,
                saw_natural_end=False,
                hit_page_cap=False,
            ),
            api.catalog_walk_complete(
                aborted=False,
                saw_natural_end=True,
                hit_page_cap=True,
            ),
        )
        for complete in incomplete_states:
            with self.subTest(complete=complete):
                called = api.mark_unseen_if_safe(
                    object(),
                    99,
                    mode="catalog",
                    complete=complete,
                    succeeded=100,
                    min_writes=50,
                )
                self.assertFalse(called)
        mark_unseen.assert_not_called()

    @patch.object(api, "mark_unseen_after_complete_catalog")
    def test_low_write_walk_never_calls_mark_unseen(self, mark_unseen) -> None:
        called = api.mark_unseen_if_safe(
            object(),
            99,
            mode="catalog",
            complete=True,
            succeeded=49,
            min_writes=50,
        )
        self.assertFalse(called)
        mark_unseen.assert_not_called()

    @patch.object(api, "mark_unseen_after_complete_catalog")
    def test_windowed_walk_never_calls_mark_unseen(self, mark_unseen) -> None:
        called = api.mark_unseen_if_safe(
            object(),
            99,
            mode="windowed",
            complete=True,
            succeeded=100,
            min_writes=50,
        )
        self.assertFalse(called)
        mark_unseen.assert_not_called()


class ListPaginationTests(unittest.TestCase):
    def test_full_page_without_next_key_continues(self) -> None:
        payload = {"results": [{} for _ in range(api.PAGE_SIZE)]}
        self.assertTrue(api.list_page_has_next(payload))

    def test_partial_page_without_next_key_is_natural_end(self) -> None:
        payload = {"results": [{} for _ in range(api.PAGE_SIZE - 1)]}
        self.assertFalse(api.list_page_has_next(payload))


class ProxySettingsTests(unittest.TestCase):
    def test_credentials_are_split_from_proxy_server(self) -> None:
        settings = api._proxy_settings(
            "https://proxy-user:p%40ssword@residential.example:8443"
        )
        self.assertEqual(settings["server"], "https://residential.example:8443")
        self.assertEqual(settings["username"], "proxy-user")
        self.assertEqual(settings["password"], "p@ssword")


if __name__ == "__main__":
    unittest.main()


class _FakeQuery:
    """Records the filters close_abandoned_runs applies."""

    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def update(self, payload):
        self.calls.append(("update", payload))
        return self

    def eq(self, col, val):
        self.calls.append(("eq", col, val))
        return self

    def lt(self, col, val):
        self.calls.append(("lt", col, val))
        return self

    def execute(self):
        class _Res:
            pass

        res = _Res()
        res.data = self.rows
        return res


class _FakeSupabase:
    def __init__(self, rows):
        self.query = _FakeQuery(rows)

    def table(self, name):
        assert name == "scrape_runs"
        return self.query


class AbandonedRunTests(unittest.TestCase):
    def test_only_closes_stale_running_rows_of_the_type(self) -> None:
        fake = _FakeSupabase([{"id": 717}])
        closed = api.close_abandoned_runs(fake, "listings")
        self.assertEqual(closed, 1)
        calls = fake.query.calls
        self.assertIn(("eq", "scrape_type", "listings"), calls)
        self.assertIn(("eq", "status", "running"), calls)
        lt = [c for c in calls if c[0] == "lt"]
        self.assertEqual(lt[0][1], "started_at")
        cutoff = dt.datetime.fromisoformat(lt[0][2])
        age = dt.datetime.now(dt.timezone.utc) - cutoff
        self.assertGreaterEqual(age, dt.timedelta(hours=api.ABANDONED_AFTER_HOURS - 0.01))
        update = [c for c in calls if c[0] == "update"][0][1]
        self.assertEqual(update["status"], "failed")
        self.assertIn("abandoned", update["error_message"])

    def test_database_error_does_not_stop_the_run(self) -> None:
        class Broken:
            def table(self, _name):
                raise RuntimeError("network down")

        self.assertEqual(api.close_abandoned_runs(Broken()), 0)


class SkipUnchangedTests(unittest.TestCase):
    NOW = dt.datetime(2026, 9, 27, 12, tzinfo=dt.timezone.utc)
    WEEK = dt.timedelta(days=6)

    def stored(self, **over):
        row = {
            "listing_id": "123",
            "price": 250,
            "currency": "USD",
            "last_updated_at": "2026-09-25T08:00:00+00:00",
            "is_active": True,
            "sold_at": None,
        }
        row.update(over)
        return row

    def check(self, item, stored):
        return api.is_unchanged(item, stored, now=self.NOW, refetch_after=self.WEEK)

    def test_same_price_recently_read_is_skipped(self) -> None:
        self.assertTrue(self.check({"key": "123", "price": 250}, self.stored()))
        self.assertTrue(self.check({"key": "123", "price": "250.00"}, self.stored()))
        self.assertTrue(
            self.check({"key": "123", "price": {"amount": 250}}, self.stored())
        )

    def test_price_change_is_fetched(self) -> None:
        self.assertFalse(self.check({"key": "123", "price": 225}, self.stored()))

    def test_missing_list_price_is_fetched(self) -> None:
        self.assertFalse(self.check({"key": "123"}, self.stored()))
        self.assertFalse(self.check({"key": "123", "price": None}, self.stored()))

    def test_unknown_or_inactive_listing_is_fetched(self) -> None:
        item = {"key": "123", "price": 250}
        self.assertFalse(self.check(item, None))
        self.assertFalse(self.check(item, self.stored(is_active=False)))
        self.assertFalse(
            self.check(item, self.stored(sold_at="2026-06-01T00:00:00+00:00"))
        )

    def test_stale_details_are_reread(self) -> None:
        item = {"key": "123", "price": 250}
        self.assertFalse(
            self.check(item, self.stored(last_updated_at="2026-09-20T08:00:00+00:00"))
        )
        self.assertFalse(self.check(item, self.stored(last_updated_at=None)))

    def test_currency_change_is_fetched(self) -> None:
        item = {"key": "123", "price": 250, "localized_price_currency": "CAD"}
        self.assertFalse(self.check(item, self.stored()))
        item["localized_price_currency"] = "$"
        self.assertTrue(self.check(item, self.stored()))

    def test_flag_turns_it_off(self) -> None:
        with mock.patch.dict(os.environ, {"SKIP_UNCHANGED": "0"}):
            self.assertFalse(api._skip_unchanged_enabled())
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SKIP_UNCHANGED", None)
            self.assertTrue(api._skip_unchanged_enabled())


class _TouchQuery:
    def __init__(self, log, table, fail):
        self.log, self.table, self.fail = log, table, fail

    def update(self, payload):
        self.payload = payload
        return self

    def in_(self, col, ids):
        self.col, self.ids = col, list(ids)
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError("boom")
        self.log.append((self.table, self.col, self.ids, self.payload))
        return None


class _TouchSupabase:
    def __init__(self, fail_tables=()):
        self.calls = []
        self.fail_tables = set(fail_tables)

    def table(self, name):
        return _TouchQuery(self.calls, name, name in self.fail_tables)


class TouchSeenTests(unittest.TestCase):
    def test_bumps_listings_and_canonical_rows_in_batches(self) -> None:
        fake = _TouchSupabase()
        ids = [str(i) for i in range(api.TOUCH_BATCH_SIZE + 5)]
        n = api.touch_seen(fake, ids, "2026-09-27T12:00:00+00:00")
        self.assertEqual(n, len(ids))
        listings = [c for c in fake.calls if c[0] == "listings"]
        canonical = [c for c in fake.calls if c[0] == "market_listings"]
        self.assertEqual(len(listings), 2)
        self.assertEqual(listings[0][1], "listing_id")
        self.assertEqual(listings[0][3], {"last_seen_at": "2026-09-27T12:00:00+00:00"})
        self.assertEqual(canonical[0][1], "id")
        self.assertEqual(canonical[0][2][0], "mm_0")

    def test_failed_bump_is_not_counted(self) -> None:
        fake = _TouchSupabase(fail_tables={"listings"})
        self.assertEqual(api.touch_seen(fake, ["1", "2"], "x"), 0)


class SkipUnchangedWalkTests(unittest.TestCase):
    def test_walk_reads_changed_and_new_listings_only(self) -> None:
        recent = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).isoformat()
        known = {
            "1": {"listing_id": "1", "price": 200, "currency": "USD",
                  "last_updated_at": recent, "is_active": True, "sold_at": None},
            "2": {"listing_id": "2", "price": 300, "currency": "USD",
                  "last_updated_at": recent, "is_active": True, "sold_at": None},
        }
        items = [
            {"key": "1", "price": 200, "category_name": "Crested Gecko"},
            {"key": "2", "price": 275, "category_name": "Crested Gecko"},
            {"key": "3", "price": 150, "category_name": "Crested Gecko"},
        ]
        fetched: list[str] = []
        touched: list[str] = []

        def detail(listing_id, _fetcher):
            fetched.append(listing_id)
            return {"id": listing_id, "price": 1, "owner": {"slug": "s", "name": "S"},
                    "category": {"name": "Crested Geckos"}}

        def touch(_sb, ids, _at):
            touched.extend(ids)
            return len(ids)

        class Fetcher:
            def close(self):
                pass

        env = {"INGEST_MODE": "catalog", "SKIP_UNCHANGED": "1", "MAX_PAGES": "1"}
        with patch.dict(os.environ, env), \
            patch.object(api, "apply_cli_args", return_value=False), \
            patch.object(api, "get_supabase", return_value=object()), \
            patch.object(api, "close_abandoned_runs", return_value=0), \
            patch.object(api, "start_scrape_run", return_value=1), \
            patch.object(api, "finalise_scrape_run"), \
            patch.object(api, "load_known_live", return_value=known), \
            patch.object(api, "touch_seen", side_effect=touch), \
            patch.object(api, "MorphMarketFetcher", return_value=Fetcher()), \
            patch.object(api, "fetch_list_page", return_value={"results": items, "next": None}), \
            patch.object(api, "fetch_detail", side_effect=detail), \
            patch.object(api, "upsert_listings", side_effect=lambda _s, _r, rows: len(rows)), \
            patch.object(api, "write_image_and_gallery_rows"), \
            patch.object(api, "patch_canonical_extras"), \
            patch.object(api, "mark_unseen_if_safe", return_value=False), \
            patch.object(api, "request_after_scrape"), \
            patch.object(api.time, "sleep"):
            self.assertEqual(api.main(), 0)
        self.assertEqual(touched, ["1"])
        self.assertEqual(fetched, ["2", "3"])


class _RunsTable:
    """Just enough of the supabase-py query builder for scrape_runs."""

    def __init__(self, existing):
        self.existing = existing
        self.updates: list[dict] = []
        self.inserts: list[dict] = []
        self._op = None

    def select(self, *_a, **_k):
        self._op = "select"
        return self

    def eq(self, *_a, **_k):
        return self

    def gte(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def update(self, payload):
        self._op = "update"
        self.updates.append(payload)
        return self

    def insert(self, payload):
        self._op = "insert"
        self.inserts.append(payload)
        return self

    def execute(self):
        if self._op == "select":
            return mock.Mock(data=self.existing)
        if self._op == "insert":
            return mock.Mock(data=[{"id": 99}])
        return mock.Mock(data=[])


class _RunsSupabase:
    def __init__(self, existing):
        self.runs = _RunsTable(existing)

    def table(self, name):
        assert name == "scrape_runs", name
        return self.runs


class NewestCheckTests(unittest.TestCase):
    def test_mode_names_and_no_sweep(self) -> None:
        for raw in ("newest", "latest", "NEW"):
            with self.subTest(raw=raw), patch.dict(os.environ, {"INGEST_MODE": raw}):
                self.assertEqual(api.ingest_mode(), "newest")
        self.assertFalse(
            api.should_mark_unseen(mode="newest", complete=True, succeeded=500, min_writes=50)
        )

    def test_reuses_todays_run_row(self) -> None:
        fake = _RunsSupabase(
            [{"id": 7, "records_attempted": 10, "records_succeeded": 4, "records_failed": 1}]
        )
        run_id, before = api.start_newest_run(fake)
        self.assertEqual(run_id, 7)
        self.assertEqual(before, {"attempted": 10, "succeeded": 4, "failed": 1})
        self.assertEqual(fake.runs.updates[0]["status"], "running")
        self.assertEqual(fake.runs.inserts, [])

    def test_opens_a_row_on_the_first_run_of_the_day(self) -> None:
        fake = _RunsSupabase([])
        run_id, before = api.start_newest_run(fake)
        self.assertEqual(run_id, 99)
        self.assertEqual(before, {"attempted": 0, "succeeded": 0, "failed": 0})
        self.assertEqual(fake.runs.inserts[0]["scrape_type"], "listings_newest")

    def _run(self, pages, known, before):
        recent = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2)).isoformat()
        stored = {
            lid: {"listing_id": lid, "price": price, "currency": "USD",
                  "last_updated_at": recent, "is_active": True, "sold_at": None}
            for lid, price in known.items()
        }
        fetched: list[str] = []
        listed_pages: list[int] = []
        requested: list[str] = []
        finalised: dict = {}

        def list_page(page, _fetcher):
            listed_pages.append(page)
            if page <= len(pages):
                return {"results": pages[page - 1], "next": "more"}
            return {"results": [], "next": None}

        def detail(listing_id, _fetcher):
            fetched.append(listing_id)
            return {"id": listing_id, "price": 1, "owner": {"slug": "s", "name": "S"},
                    "category": {"name": "Crested Geckos"}}

        def lookup(_sb, ids):
            return {i: stored[i] for i in ids if i in stored}

        def finalise(_sb, run_id, **kwargs):
            finalised.update(kwargs, run_id=run_id)

        class Fetcher:
            def close(self):
                pass

        env = {"INGEST_MODE": "newest", "SKIP_UNCHANGED": "1", "TRIGGERED_BY": "test"}
        with patch.dict(os.environ, env), \
            patch.object(api, "apply_cli_args", return_value=False), \
            patch.object(api, "get_supabase", return_value=object()), \
            patch.object(api, "start_newest_run", return_value=(5, before)), \
            patch.object(api, "start_scrape_run") as catalog_run, \
            patch.object(api, "finalise_scrape_run", side_effect=finalise), \
            patch.object(api, "load_known_live") as load_all, \
            patch.object(api, "load_known_for", side_effect=lookup), \
            patch.object(api, "touch_seen") as touch, \
            patch.object(api, "MorphMarketFetcher", return_value=Fetcher()), \
            patch.object(api, "fetch_list_page", side_effect=list_page), \
            patch.object(api, "fetch_detail", side_effect=detail), \
            patch.object(api, "upsert_listings", side_effect=lambda _s, _r, rows: len(rows)), \
            patch.object(api, "write_image_and_gallery_rows"), \
            patch.object(api, "patch_canonical_extras"), \
            patch.object(api, "mark_unseen_after_complete_catalog") as sweep, \
            patch.object(api, "request_after_scrape",
                         side_effect=lambda _sb, source: requested.append(source)), \
            patch.object(api.time, "sleep"):
            self.assertEqual(api.main(), 0)
        catalog_run.assert_not_called()
        load_all.assert_not_called()
        touch.assert_not_called()
        sweep.assert_not_called()
        return fetched, listed_pages, requested, finalised

    def test_reads_new_and_repriced_then_stops_at_a_page_with_nothing_new(self) -> None:
        crested = {"category_name": "Crested Gecko"}
        pages = [
            [
                {"key": "1", "price": 200, **crested},
                {"key": "2", "price": 150, **crested},
                {"key": "x", "price": 90, "category_name": "Leopard Gecko"},
                {"key": "3", "price": 250, **crested},
            ],
            [{"key": "4", "price": 400, **crested}],
            [{"key": "5", "price": 500, **crested}],
        ]
        known = {"1": 200, "3": 300, "4": 400}
        fetched, listed_pages, requested, finalised = self._run(
            pages, known, {"attempted": 10, "succeeded": 5, "failed": 0}
        )
        self.assertEqual(fetched, ["2", "3"])
        self.assertEqual(listed_pages, [1, 2])
        self.assertEqual(requested, ["newest:test"])
        self.assertEqual(finalised["run_id"], 5)
        self.assertEqual(finalised["attempted"], 14)
        self.assertEqual(finalised["succeeded"], 7)
        self.assertEqual(finalised["status"], "success")

    def test_nothing_new_reads_one_page_and_asks_for_no_refresh(self) -> None:
        pages = [[{"key": "1", "price": 200, "category_name": "Crested Gecko"}]]
        fetched, listed_pages, requested, finalised = self._run(
            pages, {"1": 200}, {"attempted": 0, "succeeded": 0, "failed": 0}
        )
        self.assertEqual(fetched, [])
        self.assertEqual(listed_pages, [1])
        self.assertEqual(requested, [])
        self.assertEqual(finalised["succeeded"], 0)


class AfterScrapeRequestTests(unittest.TestCase):
    def test_request_is_sent_and_failures_are_swallowed(self) -> None:
        from lib.after_scrape import request_after_scrape

        ok = mock.Mock()
        self.assertTrue(request_after_scrape(ok, "catalog:test"))
        ok.rpc.assert_called_once_with("request_after_scrape", {"p_source": "catalog:test"})

        broken = mock.Mock()
        broken.rpc.side_effect = RuntimeError("timeout")
        self.assertFalse(request_after_scrape(broken, "newest:test"))


import backfill_history as bf  # noqa: E402


class BackfillTests(unittest.TestCase):
    def test_sampled_ids_step_down_on_multiples(self) -> None:
        self.assertEqual(bf.sampled_ids(1000, 900, 25), [1000, 975, 950, 925, 900])
        self.assertEqual(bf.sampled_ids(1010, 990, 25), [1000])
        self.assertEqual(bf.sampled_ids(900, 1000, 25), [])

    def test_oldest_id_is_median_near_target(self) -> None:
        t = dt.datetime(2025, 9, 1, tzinfo=dt.timezone.utc)
        pairs = [(3300000 + i * 1000, t + dt.timedelta(days=i - 3)) for i in range(7)]
        pairs.append((1900000, t))  # a relisted outlier does not move the median much
        pairs.append((4000000, t + dt.timedelta(days=300)))  # far from target, ignored
        self.assertEqual(bf.estimate_oldest_id(pairs, t), 3302500)
        self.assertIsNone(bf.estimate_oldest_id(pairs[:3], t))

    def test_gone_row_has_no_detail_fields(self) -> None:
        row = bf.backfill_row(3400000, every=25, status=404)
        self.assertEqual(row, {"listing_id": "3400000", "http_status": 404, "sample_every": 25})

    def test_crested_row_keeps_price_traits_and_sold_state(self) -> None:
        detail = {
            "id": 3400025,
            "first_listed": "2025-11-02T10:00:00Z",
            "state": "sold",
            "price": 350,
            "localized_price_currency": "$",
            "title": "Lilly White female",
            "sex": "Female",
            "category": {"name": "Crested Geckos", "scientific_name": "Correlophus ciliatus"},
            "cached_traits": [{"name": "Lilly White"}],
        }
        row = bf.backfill_row(3400025, every=25, status=200, detail=detail)
        self.assertTrue(row["is_crested"])
        self.assertTrue(row["is_sold"])
        self.assertEqual(row["price"], 350)
        self.assertEqual(row["currency"], "USD")
        self.assertEqual(row["first_listed_at"][:10], "2025-11-02")

    def test_other_species_row_is_dated_but_not_priced(self) -> None:
        detail = {"id": 1, "first_listed": "2025-11-02", "state": "for_sale", "price": 90,
                  "category": {"name": "Ball Pythons", "scientific_name": "Python regius"}}
        row = bf.backfill_row(1, every=25, status=200, detail=detail)
        self.assertFalse(row["is_crested"])
        self.assertNotIn("price", row)
        self.assertFalse(row["is_sold"])
