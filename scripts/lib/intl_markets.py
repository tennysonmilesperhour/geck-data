"""Pure parsers for the international market scrapers.

No network and no database here, so every rule can be tested from saved
HTML. scrape_cross_platform.py does the fetching and writing.

Covers:
  - Next.js server-action ids in client JS chunks (Feedle rotates them on
    every deploy, and the homepage HTML no longer carries them).
  - Cafe24 storefront category pages. Most Korean breeder shops (Gecko
    Village, Crepax, New Run Reptile, The Zoo and others) run on Cafe24,
    whose skins differ in markup but always link products as
    /product/<name>/<no>/ or product_no=<no> and print prices as "N원".
  - terraristik.com, the largest European reptile classifieds site. Search
    pages link ads as /tb/buy-and-sell/<slug>/a<id>/ and ad pages carry a
    "<title> - <place> - www.terraristik.com" page title and euro prices in
    the text.
"""
from __future__ import annotations

import html as html_lib
import re
from typing import Any, Optional
from urllib.parse import urljoin

# ---------------------------------------------------------------------------
# Next.js server actions
# ---------------------------------------------------------------------------

_ACTION_ID = r"[0-9a-f]{40,44}"
_CREATE_REF_RE = re.compile(
    r'createServerReference\)?\(\s*"(' + _ACTION_ID + r')"[^;]{0,240}?"([A-Za-z0-9_$]+)"\s*\)'
)
_SCRIPT_SRC_RE = re.compile(r'<script[^>]+src="([^"]+\.js[^"]*)"', re.IGNORECASE)


def script_srcs(html: str, origin: str) -> list[str]:
    """Absolute URLs of the page's Next.js chunks, app chunks first."""
    out: list[str] = []
    for src in _SCRIPT_SRC_RE.findall(html or ""):
        if "/_next/" not in src:
            continue
        url = urljoin(origin, html_lib.unescape(src))
        if url not in out:
            out.append(url)
    # Page and layout chunks hold the page's actions; framework chunks never do.
    out.sort(key=lambda u: (0 if "/app/" in u else 1, u))
    return out


def find_server_action_id(js: str, name: str) -> Optional[str]:
    """The action id bound to `name` in a client chunk, if present."""
    if not js or name not in js:
        return None
    for action_id, bound in _CREATE_REF_RE.findall(js):
        if bound == name:
            return action_id
    # Minified builds sometimes drop the helper name. Take the closest id
    # before the quoted action name.
    for m in re.finditer(r'"' + re.escape(name) + r'"', js):
        window = js[max(0, m.start() - 400) : m.start()]
        ids = re.findall(r'"(' + _ACTION_ID + r')"', window)
        if ids:
            return ids[-1]
    return None


_CURSOR_KEY_RE = re.compile(r'(?:[{,]\s*|["\'])([a-z][A-Za-z0-9_]*[Cc]ursor)["\']?\s*:')


def cursor_param_names(js: str) -> list[str]:
    """Object keys ending in "cursor" in a JS chunk, price cursors excluded.

    Feedle renames its paging field between deploys (createdAtCursor, then a
    listed-at cursor). Reading the names from the live JS keeps the scraper
    in step without a code change.
    """
    out: list[str] = []
    for name in _CURSOR_KEY_RE.findall(js or ""):
        if "price" in name.lower() or name in out:
            continue
        out.append(name)
    return out


# ---------------------------------------------------------------------------
# Cafe24 (Korean shops)
# ---------------------------------------------------------------------------

_PRODUCT_NO_RE = re.compile(
    r'href="([^"]*?(?:/product/[^"/]+/(\d+)/|product_no=(\d+))[^"]*)"', re.IGNORECASE
)
_KRW_RE = re.compile(r"([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,9})\s*원")
_ALT_RE = re.compile(r'alt="([^"]{2,200})"', re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_SOLD_OUT_RE = re.compile(r"품절|sold\s*out|soldout|ico_product_soldout", re.IGNORECASE)
# Food, supplies and enclosures share the category pages on some shops.
KR_NON_ANIMAL_RE = re.compile(
    r"사료|먹이|슈퍼푸드|레파시|판게아|판고아|사육장|케이지|용품|은신처|파우더|"
    r"영양제|칼슘|바닥재|매트|온도계|습도계|\bCGD\b|pangea|repashy",
    re.IGNORECASE,
)
# 페어 = pair, 트리오 = trio, 세트 = set, 일괄 = bulk, N마리 = N animals.
KR_GROUP_RE = re.compile(r"페어|트리오|세트|일괄|[2-9]\s*마리|\bpair\b|\btrio\b", re.IGNORECASE)
KR_SEX_RE = (
    (re.compile(r"수컷|숫컷|\bmale\b|\(m\)|♂", re.IGNORECASE), "male"),
    (re.compile(r"암컷|\bfemale\b|\(f\)|♀", re.IGNORECASE), "female"),
)


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(_TAG_RE.sub(" ", fragment))).strip()


def _cafe24_name(segment: str) -> Optional[str]:
    # Most skins: <strong class="name"><a ...><span class="title ...">상품명</span> :</span> <span>NAME</span></a></strong>
    m = re.search(r'class="[^"]*\bname\b[^"]*"[^>]*>(.*?)</(?:strong|p|div)>', segment, re.S | re.I)
    if m:
        text = _text(m.group(1))
        text = re.sub(r"^(상품명|Product Name)\s*:\s*", "", text).strip()
        if text:
            return text
    alts = [a for a in _ALT_RE.findall(segment) if not re.search(r"icon|ico_|품절|new|best", a, re.I)]
    return html_lib.unescape(alts[0]).strip() if alts else None


def parse_cafe24_list(html: str, base_url: str) -> list[dict[str, Any]]:
    """Products on one Cafe24 list page: product_no, name, price_krw, sold_out, url."""
    html = html or ""
    hits = list(_PRODUCT_NO_RE.finditer(html))
    firsts: list[tuple[int, str, str]] = []
    seen: set[str] = set()
    for m in hits:
        no = m.group(2) or m.group(3)
        if no in seen:
            continue
        seen.add(no)
        firsts.append((m.start(), no, urljoin(base_url, html_lib.unescape(m.group(1)))))
    out: list[dict[str, Any]] = []
    for i, (start, no, url) in enumerate(firsts):
        end = firsts[i + 1][0] if i + 1 < len(firsts) else min(len(html), start + 6000)
        # Look a little before the link too: some skins put the image first.
        segment = html[max(0, start - 600) : end] if i == 0 else html[start:end]
        name = _cafe24_name(segment)
        prices = [int(p.replace(",", "")) for p in _KRW_RE.findall(_text(segment))]
        prices = [p for p in prices if 1000 <= p <= 100_000_000]
        # "판매가 / 할인판매가": the lowest listed price is what a buyer pays.
        price = min(prices) if prices else None
        if not name:
            continue
        out.append(
            {
                "product_no": no,
                "name": name,
                "price_krw": price,
                "sold_out": bool(_SOLD_OUT_RE.search(segment)),
                "url": url,
            }
        )
    return out


def kr_listing_flags(name: str) -> dict[str, Any]:
    sex = None
    for rx, value in KR_SEX_RE:
        if rx.search(name or ""):
            sex = value
            break
    return {
        "is_animal": not KR_NON_ANIMAL_RE.search(name or ""),
        "is_group_lot": bool(KR_GROUP_RE.search(name or "")),
        "sex": sex,
    }


# ---------------------------------------------------------------------------
# terraristik.com (Europe)
# ---------------------------------------------------------------------------

_TERRA_AD_RE = re.compile(r'href="((?:https?://www\.terraristik\.com)?/tb/buy-and-sell/[^"/]+/a(\d+)/)"')
# German and English styles: 150 €, 150,- €, 1.200 €, 1.200,00 EUR, € 99.50
_NUM = r"(\d{1,3}(?:\.\d{3})+|\d{1,5})(?:[,.](\d{1,2}|-))?"
_EUR_RES = (
    re.compile(r"(?<![\d.,])" + _NUM + r"\s*(?:€|EUR\b|Euro\b)", re.I),
    re.compile(r"(?:€|EUR)\s*" + _NUM + r"(?![\d.,])", re.I),
)
_DATE_RE = re.compile(r"\b(\d{2})\.(\d{2})\.(20\d{2})\b")
TERRA_CRESTED_RE = re.compile(r"correlophus\s+ciliatus|crested\s*gecko|kronengecko|rhacodactylus\s+ciliatus", re.I)
TERRA_WANTED_RE = re.compile(r"\b(suche|gesucht|wanted|looking for|zoek|cherche|search(?:ing)?)\b", re.I)
# Ads naming other New Caledonian geckos are usually mixed-species lists.
TERRA_OTHER_RE = re.compile(r"sarasinorum|chahoua|leachianus|auriculatus|gargoyle|mniarogekko", re.I)


def parse_terraristik_search(html: str) -> list[tuple[str, str]]:
    """(ad_id, absolute url) for each ad linked on a search page."""
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for href, ad_id in _TERRA_AD_RE.findall(html or ""):
        if ad_id in seen:
            continue
        seen.add(ad_id)
        out.append((ad_id, urljoin("https://www.terraristik.com", href)))
    return out


def eur_prices(text: str) -> list[float]:
    found: list[float] = []
    for rx in _EUR_RES:
        for main, frac in rx.findall(text or ""):
            value = float(main.replace(".", ""))
            if frac and frac != "-":
                value += int(frac) / (10 ** len(frac))
            if 5 <= value <= 20000 and value not in found:
                found.append(value)
    return found


def parse_terraristik_ad(html: str) -> dict[str, Any]:
    """Title, place, posting date, euro prices and flags from one ad page."""
    html = html or ""
    m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    page_title = _text(m.group(1)) if m else ""
    parts = [p.strip() for p in page_title.split(" - ")]
    if parts and parts[-1].lower().endswith("terraristik.com"):
        parts = parts[:-1]
    place = parts[-1] if len(parts) >= 2 else None
    title = " - ".join(parts[:-1]) if len(parts) >= 2 else (parts[0] if parts else "")
    body = _text(re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I))
    prices = eur_prices(body)
    dates = _DATE_RE.findall(body)
    posted = f"{dates[0][2]}-{dates[0][1]}-{dates[0][0]}" if dates else None
    text = f"{title} {body}"
    return {
        "title": title,
        "place": place,
        "posted": posted,
        "prices": prices,
        "price_eur": prices[0] if len(prices) == 1 else None,
        "multi_price": len(prices) > 1,
        "is_crested": bool(TERRA_CRESTED_RE.search(text)),
        "mixed_species": bool(TERRA_OTHER_RE.search(title)),
        "wanted": bool(TERRA_WANTED_RE.search(title)),
        "text": body[:4000],
    }


# ---------------------------------------------------------------------------
# Exchange rates
# ---------------------------------------------------------------------------

def parse_frankfurter(payload: dict[str, Any], wanted: tuple[str, ...]) -> dict[str, float]:
    """{currency: units per 1 USD} from a Frankfurter latest?from=USD reply."""
    rates = payload.get("rates") if isinstance(payload, dict) else None
    if not isinstance(rates, dict):
        return {}
    out: dict[str, float] = {}
    for cur in wanted:
        try:
            value = float(rates.get(cur))
        except (TypeError, ValueError):
            continue
        if value > 0:
            out[cur] = value
    return out


# ---------------------------------------------------------------------------
# Repsuki (Japan). A reptile search site that lists stock from Japanese
# shops (182 crested geckos from 25 shops in Sep 2026). Each card links
# /reptile/r_<shop>_<id> and holds the species, the morph, a yen price and
# the shop name.
# ---------------------------------------------------------------------------

_REPSUKI_CARD_RE = re.compile(r'<a\b[^>]*href="(/reptile/(r_\d+_\d+))"[^>]*>(.*?)</a>', re.S)
_REPSUKI_H2_RE = re.compile(r"<h2>(.*?)</h2>", re.S)
_REPSUKI_PRICE_RE = re.compile(r"([0-9][0-9,]{2,})\s*(?:<[^>]+>\s*)*円")
_REPSUKI_SHOP_RE = re.compile(r'<span class="truncate">([^<]+)</span>\s*</div>\s*</div>\s*$', re.S)
JP_SOLD_RE = re.compile(r"売約済|売り切れ|SOLD\s*OUT|商談中", re.I)


def parse_repsuki_list(html: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for href, rid, body in _REPSUKI_CARD_RE.findall(html or ""):
        if rid in seen:
            continue
        seen.add(rid)
        h2 = _REPSUKI_H2_RE.search(body)
        spans = [ _text(x) for x in re.findall(r"<span[^>]*>(.*?)</span>", h2.group(1), re.S)] if h2 else []
        species = spans[0] if spans else ""
        name = " ".join(s for s in spans[1:] if s) or species
        price_m = _REPSUKI_PRICE_RE.search(body)
        shop_m = _REPSUKI_SHOP_RE.search(body)
        out.append(
            {
                "id": rid,
                "url": "https://repsuki.com" + href,
                "species": species,
                "name": name,
                "price_jpy": int(price_m.group(1).replace(",", "")) if price_m else None,
                "shop": html_lib.unescape(shop_m.group(1)).strip() if shop_m else None,
                "sold": bool(JP_SOLD_RE.search(_text(body))),
            }
        )
    return out


JP_CRESTED_RE = re.compile(r"クレステッド|オウカンミカドヤモリ|crested", re.I)
JP_GROUP_RE = re.compile(r"ペア|トリオ|セット|[2-9]\s*匹|まとめ", re.I)
JP_SEX_RE = (
    (re.compile(r"♂|オス|雄", re.I), "male"),
    (re.compile(r"♀|メス|雌", re.I), "female"),
)


def jp_listing_flags(text: str) -> dict[str, Any]:
    sex = None
    for rx, value in JP_SEX_RE:
        if rx.search(text or ""):
            sex = value
            break
    return {"is_group_lot": bool(JP_GROUP_RE.search(text or "")), "sex": sex}


# ---------------------------------------------------------------------------
# imweb (Korean shops such as Hello Gecko). Product cards link
# /shop_view/?idx=<n>; the name is in an <h2> and the price in class "pay".
# ---------------------------------------------------------------------------

_IMWEB_LINK_RE = re.compile(r'href="(/shop_view/\?idx=(\d+))"')
_IMWEB_H2_RE = re.compile(r"<h2[^>]*>(.*?)</h2>", re.S)
_IMWEB_PAY_RE = re.compile(r'class="pay[^"]*"[^>]*>\s*([0-9][0-9,]*)\s*원')


def parse_imweb_list(html: str, base_url: str) -> list[dict[str, Any]]:
    html = html or ""
    starts: list[tuple[int, str, str]] = []
    seen: set[str] = set()
    for m in _IMWEB_LINK_RE.finditer(html):
        if m.group(2) in seen:
            continue
        seen.add(m.group(2))
        starts.append((m.start(), m.group(2), urljoin(base_url, html_lib.unescape(m.group(1)))))
    out: list[dict[str, Any]] = []
    for i, (start, idx, url) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else min(len(html), start + 5000)
        seg = html[start:end]
        h2 = _IMWEB_H2_RE.search(seg)
        pay = _IMWEB_PAY_RE.search(seg)
        name = re.sub(r"[^\w\s가-힣./()%+-]", "", _text(h2.group(1))).strip() if h2 else ""
        if not name or not pay:
            continue
        out.append(
            {
                "product_no": idx,
                "name": name,
                "price_krw": int(pay.group(1).replace(",", "")),
                "sold_out": bool(_SOLD_OUT_RE.search(seg)),
                "url": url,
            }
        )
    return out
