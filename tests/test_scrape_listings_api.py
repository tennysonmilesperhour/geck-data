from __future__ import annotations

import datetime as dt
import sys
import unittest
from pathlib import Path
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
