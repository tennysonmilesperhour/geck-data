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
            patch.object(api.time, "sleep"):
            self.assertEqual(api.main(), 0)
        self.assertEqual(touched, ["1"])
        self.assertEqual(fetched, ["2", "3"])
