"""Unit tests for scripts/lib/cross_platform.py. Run from repo root:

    python3 -m unittest tests.test_cross_platform
"""
from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from lib.cross_platform import (  # noqa: E402
    altitude_catalog_item_is_crested,
    altitude_catalog_items,
    altitude_item_is_crested,
    altitude_listing_from_item,
    exclude_from_combo_arb,
    feedle_air_usd,
    is_crested_text,
    is_feedle_group_lot,
    is_group_lot_text,
    is_merch_text,
    krw_to_usd,
    parse_excerpt_fields,
    squarespace_category_labels,
    squarespace_product_payload,
    squarespace_price_usd,
)


class CrestedFilters(unittest.TestCase):
    def test_crested_title(self) -> None:
        self.assertTrue(is_crested_text("Het Leucistic Crested Gecko"))
        self.assertFalse(is_crested_text("Red Super Blotched Gargoyle Gecko"))
        self.assertFalse(is_crested_text("Vital Meal Fruits"))

    def test_merch(self) -> None:
        self.assertTrue(is_merch_text("Crested Gecko T-Shirt", "T-shirt"))
        self.assertTrue(is_merch_text("Pangea Gecko Diet Sample Pack"))
        self.assertTrue(is_merch_text("Gift Cards"))
        self.assertFalse(is_merch_text("Axanthic Lilly White Crested Gecko"))
        self.assertFalse(is_merch_text("Het Leucistic Crested Gecko", "crested gecko", "shipping"))

    def test_group_lot(self) -> None:
        self.assertTrue(is_group_lot_text("Baby Crested Gecko Mystery Box"))
        self.assertTrue(is_group_lot_text("Wholesale Baby Crested Geckos"))
        self.assertTrue(is_group_lot_text("Cappuccino Crested Gecko Special"))
        self.assertFalse(is_group_lot_text("Axanthic Lilly White Crested Gecko"))

    def test_feedle_group_lot_ignores_morph_tokens(self) -> None:
        self.assertFalse(
            is_feedle_group_lot(traits=["Full Pinstripe", "Quad", "Drippy"])
        )
        self.assertTrue(is_feedle_group_lot(title="Mystery box 5-pack"))
        # Joined trait titles must not trip pair/trio/quad/group as packs.
        self.assertFalse(is_feedle_group_lot(title="Full Pinstripe Quad Drippy"))
        self.assertFalse(is_feedle_group_lot(title="Pair Lilly White"))
        self.assertFalse(is_feedle_group_lot(title="Trio Extreme Harlequin"))
        self.assertTrue(is_feedle_group_lot(title="group of 3"))
        self.assertTrue(is_feedle_group_lot(size="x2"))

    def test_exclude_combo(self) -> None:
        self.assertTrue(exclude_from_combo_arb("$79 Hand-Picked Hatchling"))
        self.assertTrue(exclude_from_combo_arb("Gift Cards"))


class AltitudeFilters(unittest.TestCase):
    def setUp(self) -> None:
        self.categories = squarespace_category_labels(
            {
                "nestedCategories": {
                    "all": {
                        "id": "all",
                        "displayName": "All Available Crested Geckos",
                    },
                    "categories": [
                        {
                            "id": "females",
                            "displayName": "Females",
                            "fullSlug": "/females",
                        },
                        {
                            "id": "other",
                            "displayName": "Other Geckos",
                            "fullSlug": "/other-geckos",
                        },
                        {
                            "id": "addons",
                            "displayName": "Add On Item",
                            "fullSlug": "/add-on-item",
                        },
                    ],
                }
            }
        )

    def test_keeps_coded_crested_gecko(self) -> None:
        item = {
            "title": "24-IM-XP-9-30",
            "productType": 1,
            "categoryIds": ["females"],
            "excerpt": "<p>Morph: AXANTHIC LILLY WHITE</p><p>Weight: 35 GRAMS</p><p>Sex: Female</p>",
        }
        self.assertTrue(altitude_item_is_crested(item, self.categories))

    def test_keeps_explicit_crested_hatchling(self) -> None:
        item = {
            "title": "$79 Hand-Picked Hatchling",
            "productType": 1,
            "categoryIds": ["all"],
            "excerpt": "A hand-picked crested gecko",
        }
        self.assertTrue(altitude_item_is_crested(item, self.categories))

    def test_drops_gift_card(self) -> None:
        item = {
            "title": "Gift Cards",
            "productType": 4,
            "categoryIds": ["all"],
        }
        self.assertFalse(altitude_item_is_crested(item, self.categories))

    def test_drops_add_on_merchandise(self) -> None:
        item = {
            "title": "Complete Hatchling Setup",
            "productType": 1,
            "categoryIds": ["addons"],
            "excerpt": "Includes a crested gecko voucher",
        }
        self.assertFalse(altitude_item_is_crested(item, self.categories))

    def test_drops_other_gecko_category(self) -> None:
        item = {
            "title": "G-42",
            "productType": 1,
            "categoryIds": ["other"],
            "excerpt": "<p>Morph: Red Stripe</p><p>Weight: 35 GRAMS</p><p>Sex: Female</p>",
        }
        self.assertFalse(altitude_item_is_crested(item, self.categories))

    def test_parses_products_from_allowed_shop_html(self) -> None:
        context = {
            "items": [{
                "id": "animal-1",
                "title": "24-IM-XP-9-30",
                "description": "<p>Morph: AXANTHIC LILLY WHITE</p>",
                "productType": 1,
                "price": {"currency": "USD", "value": "3299.00"},
                "variants": [{"price": {"currency": "USD", "value": "3299.00"}}],
                "mainImage": {"assetUrl": "https://images.example/gecko.jpg"},
            }],
            "nestedCategoryContext": {
                "all": {"id": "all", "displayName": "All Available Crested Geckos"},
                "categories": [],
            },
        }
        import html as html_lib
        import json
        markup = (
            '<div class="product-list" data-context="'
            + html_lib.escape(json.dumps(context), quote=True)
            + '"></div>'
        )
        payload = squarespace_product_payload(markup)
        self.assertEqual(payload["items"][0]["excerpt"], "<p>Morph: AXANTHIC LILLY WHITE</p>")
        self.assertEqual(payload["items"][0]["assetUrl"], "https://images.example/gecko.jpg")
        self.assertEqual(squarespace_price_usd(payload["items"][0]), 3299.0)


def _flight_page(geckos: list) -> str:
    import json

    flight = '{"geckos":' + json.dumps(geckos) + "}"
    return "<script>self.__next_f.push([1," + json.dumps(flight) + "])</script>"


class AltitudeCurrentCatalog(unittest.TestCase):
    def setUp(self) -> None:
        self.geckos = [
            {
                "name": "24-AXLHTGP5-12-1",
                "id": "24-AXLHTGP5-12-1",
                "slug": "24-axlhtgp5-12-1",
                "morph": "Axanthic Lilly White",
                "species": "Crested gecko",
                "sex": "Male",
                "weight": "33 g",
                "price": "$$2779",
                "status": "available",
                "traits": ["Axanthic Lilly White"],
                "photo": "https://cdn.shopify.com/s/files/1/0599/9542/2785/files/24-axlhtgp5-12-1-2.jpg",
                "certified": True,
                "shopifyHandle": "24-axlhtgp5-12-1",
                "variantId": "gid://shopify/ProductVariant/50861450231873",
                "sire": "Jax",
                "dam": "$undefined",
            },
            {
                "name": "24-AXSSGP6-12-14",
                "id": "24-AXSSGP6-12-14",
                "slug": "24-axssgp6-12-14",
                "morph": "100% Het Axanthic Softscale",
                "species": "Crested gecko",
                "sex": "Male",
                "weight": "$undefined",
                "price": "$$379",
                "status": "sold",
                "traits": ["100% Het Axanthic Softscale"],
                "photo": "https://cdn.shopify.com/s/files/example-sold.jpg",
                "certified": False,
                "shopifyHandle": "24-axssgp6-12-14",
                "variantId": "gid://shopify/ProductVariant/1",
            },
            {
                "name": "$$79 Hand-Picked Hatchling",
                "id": "$$79 Hand-Picked Hatchling",
                "slug": "79-hand-picked-hatchling",
                "morph": "Hand-picked hatchling",
                "species": "Crested gecko",
                "sex": "Unsexed",
                "price": "$$79",
                "status": "available",
                "traits": [],
                "photo": "/assets/hatchling.webp",
                "certified": False,
                "shopifyHandle": "79-hand-picked-hatchling",
            },
            {
                "name": "G-42",
                "id": "G-42",
                "slug": "g-42",
                "morph": "Red Stripe",
                "species": "Gargoyle gecko",
                "sex": "Female",
                "weight": "35 g",
                "price": "$$400",
                "status": "available",
                "photo": "https://cdn.shopify.com/s/files/gargoyle.jpg",
            },
            {
                "name": "Pangea Gecko Diet",
                "id": "diet-1",
                "slug": "pangea-gecko-diet",
                "morph": "Diet",
                "species": "Crested gecko",
                "price": "$$12",
                "status": "available",
                "photo": "https://cdn.shopify.com/s/files/diet.jpg",
            },
        ]
        self.items = altitude_catalog_items(_flight_page(self.geckos))

    def _row(self, external_id: str) -> dict:
        for item in self.items:
            if item["external_id"] == external_id and altitude_catalog_item_is_crested(item):
                built = altitude_listing_from_item(item)
                self.assertIsNotNone(built)
                assert built is not None
                return built[0]
        self.fail(f"missing crested row {external_id}")

    def test_reads_flight_payload_and_unescapes_prices(self) -> None:
        row = self._row("24-AXLHTGP5-12-1")
        self.assertEqual(row["title"], "24-AXLHTGP5-12-1 Axanthic Lilly White")
        self.assertEqual(row["price"], 2779.0)
        self.assertEqual(row["price_usd_equivalent"], 2779.0)
        self.assertEqual(row["url"], "https://www.altitudeexotics.com/geckos/24-axlhtgp5-12-1")
        self.assertEqual(
            row["payload"]["images"],
            ["https://cdn.shopify.com/s/files/1/0599/9542/2785/files/24-axlhtgp5-12-1-2.jpg"],
        )
        self.assertEqual(row["payload"]["sex"], "Male")
        self.assertEqual(row["payload"]["size"], "33 g")
        self.assertIsNone(row["payload"]["qty"])
        self.assertIsNone(row["payload"]["lineage"])
        self.assertFalse(row["payload"]["sold"])
        self.assertEqual(row["payload"]["sire"], "Jax")
        self.assertNotIn("dam", row["payload"])
        self.assertTrue(row["payload"]["certified"])
        self.assertIsNone(row["description"])

    def test_sold_and_missing_weight_stay_unfilled(self) -> None:
        row = self._row("24-AXSSGP6-12-14")
        self.assertEqual(row["price"], 379.0)
        self.assertTrue(row["payload"]["sold"])
        self.assertIsNone(row["payload"]["qty"])
        self.assertIsNone(row["payload"]["size"])
        self.assertNotIn("sire", row["payload"])
        self.assertNotIn("dam", row["payload"])
        self.assertFalse(row["payload"]["certified"])

    def test_hatchling_keeps_dollar_title_and_is_excluded_from_combo(self) -> None:
        row = self._row("$79 Hand-Picked Hatchling")
        self.assertEqual(row["title"], "$79 Hand-Picked Hatchling")
        self.assertEqual(row["price"], 79.0)
        self.assertEqual(row["url"], "https://www.altitudeexotics.com/geckos/79-hand-picked-hatchling")
        self.assertTrue(row["payload"]["exclude_from_combo_arb"])
        self.assertEqual(
            row["payload"]["images"],
            ["https://www.altitudeexotics.com/assets/hatchling.webp"],
        )
        self.assertIsNone(row["payload"]["qty"])
        self.assertIsNone(row["payload"]["size"])

    def test_drops_other_species_and_merch(self) -> None:
        by_id = {item["external_id"]: item for item in self.items}
        self.assertIn("G-42", by_id)
        self.assertIn("diet-1", by_id)
        self.assertFalse(altitude_catalog_item_is_crested(by_id["G-42"]))
        self.assertFalse(altitude_catalog_item_is_crested(by_id["diet-1"]))
        kept = [
            item["external_id"]
            for item in self.items
            if altitude_catalog_item_is_crested(item)
        ]
        self.assertEqual(
            kept,
            ["24-AXLHTGP5-12-1", "24-AXSSGP6-12-14", "$79 Hand-Picked Hatchling"],
        )

    def test_missing_catalog_raises_and_empty_catalog_does_not(self) -> None:
        with self.assertRaises(ValueError):
            altitude_catalog_items("<html><body>no products</body></html>")
        self.assertEqual(altitude_catalog_items(_flight_page([])), [])

    def test_legacy_squarespace_page_still_parses(self) -> None:
        import html as html_lib
        import json

        context = {
            "items": [{
                "id": "animal-1",
                "title": "24-IM-XP-9-30",
                "fullUrl": "/shop/p/24-im-xp-9-30",
                "productType": 1,
                "categoryIds": ["females"],
                "excerpt": "<p>Morph: AXANTHIC LILLY WHITE</p><p>Weight: 35 GRAMS</p><p>Sex: Female</p>",
                "variants": [{
                    "price": 329900,
                    "qtyInStock": 1,
                    "priceMoney": {"currency": "USD", "value": "3299.00"},
                }],
                "mainImage": {"assetUrl": "https://images.example/gecko.jpg"},
            }],
            "nestedCategoryContext": {
                "categories": [{
                    "id": "females",
                    "displayName": "Females",
                    "fullSlug": "/females",
                }],
            },
        }
        markup = (
            '<div class="product-list" data-context="'
            + html_lib.escape(json.dumps(context), quote=True)
            + '"></div>'
        )
        items = altitude_catalog_items(markup)
        self.assertEqual(len(items), 1)
        self.assertTrue(altitude_catalog_item_is_crested(items[0]))
        built = altitude_listing_from_item(items[0])
        self.assertIsNotNone(built)
        assert built is not None
        row, image = built
        self.assertEqual(row["external_id"], "animal-1")
        self.assertEqual(row["price"], 3299.0)
        self.assertEqual(row["payload"]["qty"], 1)
        self.assertFalse(row["payload"]["sold"])
        self.assertEqual(row["payload"]["sex"], "Female")
        self.assertEqual(row["payload"]["size"], "35 GRAMS")
        self.assertEqual(row["url"], "https://www.altitudeexotics.com/shop/p/24-im-xp-9-30")
        self.assertEqual(image, "https://images.example/gecko.jpg")


class CollectIsolation(unittest.TestCase):
    def test_earlier_and_later_source_errors_do_not_drop_the_rest(self) -> None:
        from unittest import mock

        import scrape_cross_platform as scp

        altitude_row = ({"platform": "altitude_exotics", "external_id": "sku"}, None)
        terra_row = ({"platform": "terraristik", "external_id": "ad"}, None)
        repsuki_row = ({"platform": "repsuki", "external_id": "jp"}, None)
        with mock.patch.object(scp, "scrape_feedle", side_effect=RuntimeError("feedle down")), \
                mock.patch.object(scp, "scrape_tikis", return_value=[]), \
                mock.patch.object(scp, "scrape_altitude", return_value=[altitude_row]), \
                mock.patch.object(scp, "scrape_kr_shops", side_effect=RuntimeError("shop down")), \
                mock.patch.object(scp, "scrape_terraristik", return_value=[terra_row]), \
                mock.patch.object(scp, "scrape_repsuki", return_value=[repsuki_row]):
            pairs = scp.collect("all", 1)
        self.assertEqual(
            [pair[0]["platform"] for pair in pairs],
            ["altitude_exotics", "terraristik", "repsuki"],
        )
        joined = " ".join(scp.SOURCE_ERRORS)
        self.assertIn("feedle:", joined)
        self.assertIn("kr_shops:", joined)

    def test_altitude_parse_failure_still_writes_other_sources(self) -> None:
        import sys
        from unittest import mock

        import scrape_cross_platform as scp

        class Resp:
            text = "<html><body>no products</body></html>"

        def row(platform: str, external_id: str) -> tuple:
            return (
                {
                    "platform": platform,
                    "external_id": external_id,
                    "title": external_id,
                    "price": 10.0,
                    "currency": "USD",
                    "species": "crested",
                    "payload": {"sold": False},
                },
                None,
            )

        written: list[str] = []
        finalised: list[dict] = []

        def fake_upsert(supabase, pairs):
            del supabase
            written.extend(pair[0]["platform"] for pair in pairs)
            return len(pairs), 0

        def fake_finalise(supabase, run_id, **kwargs):
            del supabase, run_id
            finalised.append(kwargs)

        supabase_mod = mock.Mock()
        supabase_mod.get_supabase.return_value = mock.Mock()
        with mock.patch.object(scp, "scrape_feedle", return_value=[row("feedle_air", "a"), row("feedle_kr", "k")]), \
                mock.patch.object(scp, "scrape_tikis", return_value=[row("tikis_geckos", "t")]), \
                mock.patch.object(scp, "scrape_kr_shops", return_value=[row("kr_shops", "s")]), \
                mock.patch.object(scp, "scrape_terraristik", return_value=[row("terraristik", "e")]), \
                mock.patch.object(scp, "scrape_repsuki", return_value=[row("repsuki", "r")]), \
                mock.patch.object(scp, "polite_get", return_value=Resp()), \
                mock.patch.object(scp, "upsert_rows", side_effect=fake_upsert), \
                mock.patch.object(scp, "update_fx_rates", return_value={}), \
                mock.patch.object(scp, "record_observations"), \
                mock.patch.object(scp, "start_scrape_run", return_value=1), \
                mock.patch.object(scp, "finalise_scrape_run", side_effect=fake_finalise), \
                mock.patch.object(sys, "argv", ["scrape_cross_platform.py", "--source=all"]), \
                mock.patch.dict(sys.modules, {"lib.supabase_client": supabase_mod}):
            code = scp.main()

        self.assertEqual(code, 1)
        self.assertEqual(
            set(written),
            {"feedle_air", "feedle_kr", "tikis_geckos", "kr_shops", "terraristik", "repsuki"},
        )
        self.assertNotIn("altitude_exotics", written)
        shops = [
            call for call in finalised
            if call.get("error_message") and "altitude" in call["error_message"]
        ]
        self.assertEqual(len(shops), 1)
        self.assertEqual(shops[0]["status"], "partial")
        self.assertGreater(shops[0]["succeeded"], 0)


class Prices(unittest.TestCase):
    def test_feedle_v1_matches_sampled_json_ld(self) -> None:
        # 5,000,000 KRW at SSR rate 1340, version 1 -> $4292 (JSON-LD).
        self.assertEqual(feedle_air_usd(5_000_000, 1340, 1), 4292)

    def test_feedle_v2_is_the_displayed_sale_ask(self) -> None:
        expected = math.ceil(0.9 * 5_000_000 / 1340 * 1.15)
        self.assertEqual(feedle_air_usd(5_000_000, 1340, 2), expected)
        self.assertIsNone(feedle_air_usd(0, 1340, 2))
        self.assertIsNone(feedle_air_usd(5_000_000, None, 2))

    def test_krw_fx_is_not_the_air_markup(self) -> None:
        self.assertEqual(krw_to_usd(1_340_000, 1340), 1000.0)
        self.assertIsNone(krw_to_usd(0, 1340))

    def test_squarespace_cents(self) -> None:
        item = {
            "variants": [
                {
                    "price": 329900,
                    "priceMoney": {"currency": "USD", "value": "3299.00"},
                }
            ]
        }
        self.assertEqual(squarespace_price_usd(item), 3299.0)

    def test_excerpt_fields(self) -> None:
        html = (
            "<p>Morph: AXANTHIC LILLY WHITE </p>"
            "<p>Weight: 35 GRAMS</p>"
            "<p>Sex: Male<br /></p>"
        )
        fields = parse_excerpt_fields(html)
        self.assertEqual(fields["morph"], "AXANTHIC LILLY WHITE")
        self.assertEqual(fields["weight"], "35 GRAMS")
        self.assertEqual(fields["sex"], "Male")


if __name__ == "__main__":
    unittest.main()
