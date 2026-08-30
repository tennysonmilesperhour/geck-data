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
    exclude_from_combo_arb,
    feedle_air_usd,
    is_crested_text,
    is_feedle_group_lot,
    is_group_lot_text,
    is_merch_text,
    krw_to_usd,
    parse_excerpt_fields,
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
