"""Print the structure of market pages so scrapers can be written against
real markup. Used from the probe-market-pages workflow, because GitHub's
runners can reach sites the development sandbox cannot.

  python probe_pages.py URL [URL ...]

For each page: status, final URL, platform hints, product-like links, the
first price matches (yen, won, euro), and a markup excerpt around the first
price. Writes nothing anywhere.
"""
from __future__ import annotations

import re
import sys
from collections import Counter
from urllib.parse import urljoin, urlsplit

import requests

UA = "GeckDataBot/1.0 (crested gecko market tracker)"
PRICE_RE = re.compile(r"(?:¥|￥|&yen;|&#165;)\s?[0-9,]{3,9}|[0-9,]{3,9}\s?(?:円|원|€)", re.I)
AROUND = [a for a in (__import__("os").environ.get("AROUND") or "").split("||") if a]
HINTS = {
    "cafe24": r"cafe24|xans-product",
    "ocnk (Ocnk/おちゃのこ)": r"ocnk|ochanoko",
    "colorme": r"colorme|shop-pro\.jp",
    "base": r"thebase|base\.shop|baseec",
    "shopify": r"cdn\.shopify|Shopify\.theme",
    "makeshop": r"makeshop",
    "eccube": r"ec-cube|eccube",
    "wordpress": r"wp-content",
    "next.js": r"__next|_next/static",
}


def probe(url: str) -> None:
    print("=" * 100)
    print("URL", url)
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "ja,ko;q=0.8,en;q=0.5"}, timeout=40)
    except Exception as exc:  # noqa: BLE001
        print("ERROR", exc)
        return
    r.encoding = r.apparent_encoding or r.encoding
    html = r.text
    print("status", r.status_code, "final", r.url, "bytes", len(html))
    print("platform hints:", [k for k, rx in HINTS.items() if re.search(rx, html, re.I)])
    m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    print("title:", (m.group(1).strip() if m else "")[:150])
    host = urlsplit(r.url).netloc
    links = re.findall(r'href="([^"#]+)"', html)
    same = [urljoin(r.url, l) for l in links if not l.startswith(("mailto:", "tel:", "javascript:"))]
    same = [l for l in same if urlsplit(l).netloc == host]
    shapes = Counter(re.sub(r"\d+", "N", urlsplit(l).path) for l in same)
    print("link path shapes (top 15):")
    for shape, n in shapes.most_common(15):
        print(f"  {n:4d}  {shape}")
    pages = sorted({l for l in same if re.search(r"(page|p)=\d|/page/\d", l)})[:6]
    print("pagination-like links:", pages)
    prices = PRICE_RE.findall(html)
    print("price matches:", len(prices), prices[:12])
    first = PRICE_RE.search(html)
    if first:
        a = max(0, first.start() - 1500)
        excerpt = re.sub(r"\s+", " ", html[a : first.end() + 600])
        print("markup around first price:\n", excerpt[:2100])
    for pat in AROUND:
        hit = re.search(pat, html)
        if hit:
            a = max(0, hit.start() - 300)
            print(f"markup around /{pat}/:\n", re.sub(r"\s+", " ", html[a : hit.start() + 3000]))
        else:
            print(f"no match for /{pat}/")
    jsonld = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    if jsonld:
        print("json-ld blocks:", len(jsonld), re.sub(r"\s+", " ", jsonld[0])[:600])


if __name__ == "__main__":
    for u in sys.argv[1:]:
        probe(u)
