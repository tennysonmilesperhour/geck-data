from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from lib import intl_markets as im  # noqa: E402

ACTION = "40" + "a1b2c3d4e5" * 4


class ServerActionTests(unittest.TestCase):
    def test_finds_named_reference(self) -> None:
        js = (
            'let a=(0,r.createServerReference)("7f' + "0" * 40 + '",r.callServer,void 0,r.findSourceMapURL,"getSellers"),'
            'b=(0,r.createServerReference)("' + ACTION + '",r.callServer,void 0,r.findSourceMapURL,"getPetList");'
        )
        self.assertEqual(im.find_server_action_id(js, "getPetList"), ACTION)

    def test_falls_back_to_nearest_id_before_name(self) -> None:
        js = 'x("' + ACTION + '",cs,void 0,fs,"getPetList")'
        self.assertEqual(im.find_server_action_id(js, "getPetList"), ACTION)

    def test_absent(self) -> None:
        self.assertIsNone(im.find_server_action_id("nothing here", "getPetList"))

    def test_script_srcs_puts_app_chunks_first(self) -> None:
        html = (
            '<script src="/_next/static/chunks/webpack-1.js"></script>'
            '<script src="/_next/static/chunks/app/(main)/page-2.js" async=""></script>'
            '<script src="https://cdn.example.com/x.js"></script>'
        )
        srcs = im.script_srcs(html, "https://air.feedle.me")
        self.assertEqual(srcs[0], "https://air.feedle.me/_next/static/chunks/app/(main)/page-2.js")
        self.assertEqual(len(srcs), 2)


CAFE24 = """
<ul class="prdList grid4">
 <li id="anchorBoxId_101" class="xans-record-">
  <div class="thumbnail"><a href="/product/릴리화이트-수컷/101/category/76/display/1/"><img src="a.jpg" alt="릴리화이트 수컷 아성체"></a></div>
  <div class="description">
   <strong class="name"><a href="/product/릴리화이트-수컷/101/category/76/display/1/"><span class="title">상품명</span> :</span> <span>릴리화이트 수컷 아성체</span></a></strong>
   <ul class="spec"><li><strong class="title">판매가</strong> <span>350,000원</span></li></ul>
  </div>
 </li>
 <li id="anchorBoxId_102" class="xans-record-">
  <div class="thumbnail"><a href="/product/detail.html?product_no=102&cate_no=76"><img src="b.jpg" alt="할리퀸 페어"></a>
   <img src="/web/upload/icon_201906111604428400.gif" alt="품절"></div>
  <strong class="name"><a href="/product/detail.html?product_no=102&cate_no=76"><span>할리퀸 페어</span></a></strong>
  <span>판매가</span> <span>500,000원</span> <span>할인판매가</span> <span>450,000원</span>
 </li>
 <li id="anchorBoxId_103"><a href="/product/레파시/103/category/76/display/1/"><img alt="레파시 크레스티드 사료"></a> 22,000원</li>
</ul>
"""


class Cafe24Tests(unittest.TestCase):
    def test_parses_products_prices_and_sold_out(self) -> None:
        items = im.parse_cafe24_list(CAFE24, "https://geckovillage.co.kr/category/x/76/")
        by_no = {i["product_no"]: i for i in items}
        self.assertEqual(set(by_no), {"101", "102", "103"})
        self.assertEqual(by_no["101"]["name"], "릴리화이트 수컷 아성체")
        self.assertEqual(by_no["101"]["price_krw"], 350000)
        self.assertFalse(by_no["101"]["sold_out"])
        self.assertTrue(by_no["101"]["url"].startswith("https://geckovillage.co.kr/product/"))
        self.assertEqual(by_no["102"]["price_krw"], 450000)
        self.assertTrue(by_no["102"]["sold_out"])

    def test_flags(self) -> None:
        self.assertEqual(im.kr_listing_flags("릴리화이트 수컷")["sex"], "male")
        self.assertTrue(im.kr_listing_flags("할리퀸 페어")["is_group_lot"])
        self.assertFalse(im.kr_listing_flags("레파시 크레스티드 사료")["is_animal"])
        self.assertTrue(im.kr_listing_flags("세이블 암컷")["is_animal"])


SEARCH = """
<div class="ad"><a href="/tb/buy-and-sell/correlophus-ciliatus-lilly-white-1-3/a1085297/">Correlophus ciliatus Lilly White</a></div>
<div class="ad"><a href="https://www.terraristik.com/tb/buy-and-sell/crested-geckos/a1081189/">Crested geckos</a>
<a href="/tb/buy-and-sell/crested-geckos/a1081189/">again</a></div>
"""

AD = """<html><head><title>Correlophus ciliatus Lilly White 0.1 - Hessen - www.terraristik.com</title>
<script>var x = "999 €";</script></head><body>
<p>Datum: 14.09.2026</p><p>Schönes Weibchen, Lilly White, Preis 450,- € VB</p></body></html>"""

WANTED = """<title>Suche Kronengecko Weibchen - Berlin - www.terraristik.com</title><p>bis 200 €</p>"""
MULTI = """<title>Crested geckos - Prague - www.terraristik.com</title><p>Harlequin 150 €, Dalmatian 200 €, Lilly White 400 €</p>"""


class TerraristikTests(unittest.TestCase):
    def test_search_dedupes_ads(self) -> None:
        ads = im.parse_terraristik_search(SEARCH)
        self.assertEqual([a[0] for a in ads], ["1085297", "1081189"])
        self.assertTrue(ads[1][1].startswith("https://www.terraristik.com/tb/"))

    def test_single_price_ad(self) -> None:
        ad = im.parse_terraristik_ad(AD)
        self.assertEqual(ad["title"], "Correlophus ciliatus Lilly White 0.1")
        self.assertEqual(ad["place"], "Hessen")
        self.assertEqual(ad["posted"], "2026-09-14")
        self.assertEqual(ad["price_eur"], 450.0)
        self.assertTrue(ad["is_crested"])
        self.assertFalse(ad["wanted"])

    def test_wanted_and_multi_price_ads(self) -> None:
        self.assertTrue(im.parse_terraristik_ad(WANTED)["wanted"])
        multi = im.parse_terraristik_ad(MULTI)
        self.assertTrue(multi["multi_price"])
        self.assertIsNone(multi["price_eur"])


class FxTests(unittest.TestCase):
    def test_frankfurter(self) -> None:
        payload = {"base": "USD", "rates": {"EUR": 0.8765, "KRW": 1355.05, "CAD": "bad"}}
        self.assertEqual(im.parse_frankfurter(payload, ("EUR", "KRW", "CAD")), {"EUR": 0.8765, "KRW": 1355.05})


if __name__ == "__main__":
    unittest.main()


class FeedleDiscoveryTests(unittest.TestCase):
    def test_reads_js_chunks_when_html_lacks_the_id(self) -> None:
        from unittest import mock

        import scrape_cross_platform as scp

        html = '<script src="/_next/static/chunks/app/(main)/page-9.js"></script>'
        js = 'n=(0,a.createServerReference)("' + ACTION + '",a.callServer,void 0,a.findSourceMapURL,"getPetList")'

        class Resp:
            text = js

        with mock.patch.object(scp, "polite_get", return_value=Resp()) as get:
            self.assertEqual(scp.discover_feedle_action_id(html), ACTION)
            get.assert_called_once_with("https://air.feedle.me/_next/static/chunks/app/(main)/page-9.js")

    def test_falls_back_when_no_chunk_has_it(self) -> None:
        from unittest import mock

        import scrape_cross_platform as scp

        class Resp:
            text = "nothing"

        html = '<script src="/_next/static/chunks/app/page-1.js"></script>'
        with mock.patch.object(scp, "polite_get", return_value=Resp()):
            self.assertEqual(scp.discover_feedle_action_id(html), scp.FEEDLE_ACTION_FALLBACK)


class FeedleCursorTests(unittest.TestCase):
    def test_cursor_names(self) -> None:
        import scrape_cross_platform as scp

        self.assertEqual(scp.feedle_next_cursor({"created_at_cursor": "a"}, {}), "a")
        self.assertEqual(scp.feedle_next_cursor({"listed_at_on_home_page_cursor": "b", "id": "1"}, {}), "b")
        self.assertEqual(scp.feedle_next_cursor({"created_at": "x"}, {"nextCursor": "n"}), "n")
        self.assertIsNone(scp.feedle_next_cursor({"id": "1"}, {"data": []}))
