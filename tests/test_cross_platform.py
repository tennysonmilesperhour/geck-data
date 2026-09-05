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
    altitude_item_is_crested,
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
