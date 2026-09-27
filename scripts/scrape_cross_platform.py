"""Ingest crested gecko markets outside MorphMarket into cross_platform_listings.

Korea: Feedle (the main Korean reptile marketplace) and Korean breeder
shops on Cafe24. Europe: terraristik.com classifieds. US: TikisGeckos and
Altitude Exotics. Each run also stores exchange rates (fx_rates) and one
price snapshot per listing per day (cross_platform_observations) so the
Markets page can show trends.

Writes ONLY public.cross_platform_listings (and optional first-image rows
in cross_platform_listing_images). Never touches market_listings, listings,
price_history, combo_index_daily, or MorphMarket median views. Never calls
mark_unseen.

Sources (public storefront HTML/JSON only):
  feedle_air  https://air.feedle.me/  via the homepage's public getPetList
              server action (same catalog the infinite-scroll grid uses).
              Native list price is KRW; Air displays USD with Feedle's
              published formula and SSR rate. We store that USD ask.
  feedle_kr   Same catalog, stored as KRW. www.feedle.me currently 307s to
              air.feedle.me, so there is no separate domestic HTML feed.
              KRW is never written into a USD column.
  tikis       https://tikisgeckos.com/products.json (Shopify, paginated)
  altitude    https://www.altitudeexotics.com/shop (Squarespace HTML)

Usage:
  python scrape_cross_platform.py --source=all --dry-run
  python scrape_cross_platform.py --source=feedle_air
  python scrape_cross_platform.py --source=tikis --dry-run --max-pages=2
  python scrape_cross_platform.py --source=kr_shops --dry-run --max-pages=1
  python scrape_cross_platform.py --source=terraristik --dry-run --max-pages=1

Env:
  SUPABASE_URL / SUPABASE_SERVICE_KEY   required unless --dry-run
  TRIGGERED_BY                          scrape_runs.triggered_by
  MAX_PAGES                             list-page cap (default 250)
  PAGE_SLEEP_S                          pause between pages (default 0.35)
  USER_AGENT                            override the polite UA
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import traceback
from typing import Any, Optional
from urllib.parse import urljoin

import requests

from lib.intl_markets import (
    find_server_action_id,
    kr_listing_flags,
    parse_cafe24_list,
    parse_frankfurter,
    parse_terraristik_ad,
    parse_terraristik_search,
    script_srcs,
)
from lib.cross_platform import (
    CRESTED_SPECIES,
    FEEDLE_CRESTED_CODE,
    OTHER_SPECIES_RE,
    altitude_item_is_crested,
    exclude_from_combo_arb,
    feedle_air_usd,
    is_crested_text,
    is_feedle_group_lot,
    is_group_lot_text,
    is_merch_text,
    krw_to_usd,
    parse_excerpt_fields,
    shopify_available,
    shopify_price_usd,
    squarespace_category_labels,
    squarespace_product_payload,
    squarespace_price_usd,
    squarespace_qty,
    traits_csv,
)

USER_AGENT = os.environ.get(
    "USER_AGENT",
    "GeckDataBot/1.0 (crested gecko market tracker)",
)
REQUEST_TIMEOUT_S = 45
UPSERT_BATCH = 50
IMAGE_BATCH = 50
FEEDLE_ORIGIN = "https://air.feedle.me"
FEEDLE_ACTION_FALLBACK = "4040e5c610e74ef64f03558baad393e91853278b2c"
TIKIS_PRODUCTS = "https://tikisgeckos.com/products.json"
ALTITUDE_SHOP = "https://www.altitudeexotics.com/shop"
FRANKFURTER = "https://api.frankfurter.app/latest"

GETPETLIST_HASH_RE = re.compile(
    r'createServerReference\)\("([0-9a-f]{40,64})",[^"]*"getPetList"',
)
EXCHANGE_RATE_RE = re.compile(r'\["\$","\$L[0-9a-z]+",null,\{"value":(\d{3,5})\}')
CRESTED_CODE_RE = re.compile(
    r'\{"id":"[0-9a-f-]+","name":"[^"]*","code":"(\d+)","name_en":"crested gecko"',
)
SESSION = requests.Session()
SESSION.headers.update(
    {
        "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
        "User-Agent": USER_AGENT,
    }
)


def log(message: str) -> None:
    ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    print(f"[{ts}] {message}", flush=True)


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def page_sleep() -> float:
    raw = os.environ.get("PAGE_SLEEP_S", "0.35")
    return max(0.0, float(raw))


def max_pages() -> int:
    raw = os.environ.get("MAX_PAGES", "250")
    return max(1, int(raw))


def start_scrape_run(supabase, scrape_type: str) -> int:
    triggered_by = os.environ.get("TRIGGERED_BY", "manual")
    row = (
        supabase.table("scrape_runs")
        .insert(
            {
                "scrape_type": scrape_type,
                "status": "running",
                "triggered_by": triggered_by,
            }
        )
        .execute()
    )
    run_id = int(row.data[0]["id"])
    log(f"scrape_runs row created id={run_id} type={scrape_type}")
    return run_id


def finalise_scrape_run(
    supabase,
    run_id: int,
    *,
    status: str,
    attempted: int,
    succeeded: int,
    failed: int,
    error_message: Optional[str] = None,
) -> None:
    supabase.table("scrape_runs").update(
        {
            "finished_at": now_iso(),
            "status": status,
            "records_attempted": attempted,
            "records_succeeded": succeeded,
            "records_failed": failed,
            "error_message": error_message,
        }
    ).eq("id", run_id).execute()
    log(
        f"scrape_runs id={run_id} closed: status={status} "
        f"attempted={attempted} succeeded={succeeded} failed={failed}"
    )


def polite_get(url: str, **kwargs: Any) -> requests.Response:
    resp = SESSION.get(url, timeout=REQUEST_TIMEOUT_S, **kwargs)
    resp.raise_for_status()
    return resp


# ---------------------------------------------------------------------------
# Feedle
# ---------------------------------------------------------------------------


def _decode_next_f(html: str) -> str:
    blob_parts: list[str] = []
    for raw in re.findall(
        r'self\.__next_f\.push\(\[(\d+),("(?:\\.|[^"\\])*")\]\)', html
    ):
        try:
            blob_parts.append(json.loads(raw[1]))
        except json.JSONDecodeError:
            continue
    return "".join(blob_parts)


def discover_feedle_action_id(html: str, max_chunks: int = 40) -> str:
    """Find getPetList's server-action id.

    Next.js assigns a new id on every Feedle deploy. It is declared in the
    page's client JS chunks, not the HTML, so read those. On 2026-09-08 a
    deploy retired the hard-coded fallback and every run after that got a
    404 while reporting nothing.
    """
    match = GETPETLIST_HASH_RE.search(html)
    if match:
        return match.group(1)
    for url in script_srcs(html, FEEDLE_ORIGIN)[:max_chunks]:
        try:
            js = polite_get(url).text
        except Exception as exc:  # noqa: BLE001
            log(f"WARN feedle chunk {url}: {exc}")
            continue
        found = find_server_action_id(js, "getPetList")
        if found:
            log(f"feedle getPetList action found in {url.rsplit('/', 1)[-1]}")
            return found
    log("WARN feedle getPetList action not found in JS; using the stored fallback")
    return FEEDLE_ACTION_FALLBACK


def discover_feedle_rate(html: str) -> Optional[float]:
    blob = _decode_next_f(html)
    match = EXCHANGE_RATE_RE.search(blob) or EXCHANGE_RATE_RE.search(html)
    if match:
        return float(match.group(1))
    # Last resort: the SSR payload on 2026-08-30 was {"value":1340}.
    loose = re.search(r'\{"value":(1[0-9]{3,4})\}', blob)
    if loose:
        return float(loose.group(1))
    return None


def discover_feedle_crested_code(html: str) -> str:
    blob = _decode_next_f(html)
    match = CRESTED_CODE_RE.search(blob) or CRESTED_CODE_RE.search(html)
    return match.group(1) if match else FEEDLE_CRESTED_CODE


def parse_flight_result(text: str) -> dict[str, Any]:
    for line in text.splitlines():
        if not line.startswith("1:"):
            continue
        payload = json.loads(line[2:])
        if isinstance(payload, dict):
            return payload
    for line in text.splitlines():
        if '"data"' in line and line[:2] in ("0:", "1:"):
            payload = json.loads(line[2:])
            if isinstance(payload, dict) and "data" in payload:
                return payload
    raise ValueError("Feedle getPetList flight response had no data object")


def feedle_get_pet_list(
    action_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    tree = [
        "",
        {
            "children": [
                "(main)",
                {"children": ["__PAGE__", {}, None, None]},
                None,
                None,
            ]
        },
        None,
        None,
    ]
    resp = SESSION.post(
        FEEDLE_ORIGIN + "/",
        data=json.dumps([payload]),
        timeout=REQUEST_TIMEOUT_S,
        headers={
            "Accept": "text/x-component",
            "Content-Type": "text/plain;charset=UTF-8",
            "Next-Action": action_id,
            "Next-Router-State-Tree": json.dumps(tree),
        },
    )
    resp.raise_for_status()
    return parse_flight_result(resp.text)


def frankfurter_usd_krw() -> Optional[float]:
    """USD per 1 KRW inverted: returns KRW per 1 USD from a public FX table."""
    try:
        resp = polite_get(
            FRANKFURTER,
            params={"from": "USD", "to": "KRW"},
        )
        data = resp.json()
        rate = float((data.get("rates") or {}).get("KRW"))
        return rate if rate > 0 else None
    except Exception as exc:  # noqa: BLE001
        log(f"WARN frankfurter FX: {exc}")
        return None


def feedle_seller_name(pet: dict[str, Any]) -> str:
    for key in ("kr_seller_name", "seller_name", "nickname", "kr_seller"):
        val = pet.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, dict):
            for nested in ("name", "name_en", "nickname", "display_name"):
                n = val.get(nested)
                if isinstance(n, str) and n.strip():
                    return n.strip()
    return "Feedle"


def feedle_image_url(pet: dict[str, Any]) -> Optional[str]:
    thumb = pet.get("thumbnailUrl") or pet.get("failUrl")
    if isinstance(thumb, str) and thumb.startswith("http"):
        return thumb
    return None


def build_feedle_rows(
    pet: dict[str, Any],
    *,
    air_rate: Optional[float],
    kr_rate: Optional[float],
    kr_rate_source: str,
) -> list[tuple[dict[str, Any], Optional[str]]]:
    species_name = str(pet.get("species_name_en") or "")
    traits = pet.get("trait_names_en") if isinstance(pet.get("trait_names_en"), list) else []
    # getPetList is already called with species=0001 (crested). Skip only
    # if the English species label is clearly another animal.
    if OTHER_SPECIES_RE.search(species_name) and not is_crested_text(species_name):
        return []
    external_id = str(pet.get("id") or "")
    if not external_id:
        return []
    krw_raw = pet.get("price")
    try:
        krw = float(krw_raw) if krw_raw is not None else None
    except (TypeError, ValueError):
        krw = None
    if krw is not None and krw <= 0:
        krw = None
    version = pet.get("global_price_version")
    sale_status = str(pet.get("sale_status") or "")
    title_bits = [t for t in traits if t] or [species_name or "Crested Gecko"]
    title = " ".join(str(t) for t in title_bits)
    sex = pet.get("sex")
    size = pet.get("size")
    # Title is joined trait_names_en. Quad / Pair / Trio are morphs there,
    # so do not run the MorphMarket group-lot regex against that string.
    listing_name = pet.get("name") or pet.get("name_en") or pet.get("title")
    if isinstance(listing_name, str) and listing_name.strip() == title.strip():
        listing_name = None
    group_lot = is_feedle_group_lot(
        title=listing_name,
        size=size,
        sale=sale_status,
        traits=traits,
    )
    seller = feedle_seller_name(pet)
    url = f"{FEEDLE_ORIGIN}/pet/{external_id}"
    image = feedle_image_url(pet)
    traits_raw = traits_csv(list(traits))
    observed = now_iso()
    rows: list[tuple[dict[str, Any], Optional[str]]] = []

    air_usd = feedle_air_usd(krw, air_rate, version)
    air_payload = {
        "sex": sex,
        "size": size,
        "lineage": {
            "father_pet_id": pet.get("father_pet_id"),
            "mother_pet_id": pet.get("mother_pet_id"),
        },
        "sold": sale_status != "FOR_SALE",
        "sale_status": sale_status,
        "qty": 1 if sale_status == "FOR_SALE" else 0,
        "images": [image] if image else [],
        "source_url": url,
        "shop": "feedle_air",
        "is_group_lot": group_lot,
        "exclude_from_combo_arb": group_lot,
        "krw_price": krw,
        "usd_rate_used": air_rate,
        "usd_rate_source": "feedle_ssr",
        "global_price_version": version,
        "kr_seller_id": pet.get("kr_seller_id"),
        "kr_seller_is_guaranteed": pet.get("kr_seller_is_guaranteed"),
        "species_name_en": species_name,
        "fetch_method": "getPetList_server_action",
        # Posting and sale dates, when Feedle sends them, give Korea a
        # history the way first_listed does for MorphMarket.
        "created_at": pet.get("created_at") or pet.get("createdAt") or pet.get("created_at_cursor"),
        "updated_at": pet.get("updated_at") or pet.get("updatedAt"),
        "sold_at": pet.get("sold_at") or pet.get("soldAt"),
    }
    rows.append(
        (
            {
                "platform": "feedle_air",
                "external_id": external_id,
                "title": title,
                "description": None,
                "price": air_usd,
                "price_usd_equivalent": air_usd,
                "currency": "USD",
                "seller_name": seller,
                "seller_location": "Korea",
                "url": url,
                "traits_raw": traits_raw,
                "species": CRESTED_SPECIES,
                "last_seen_at": observed,
                "payload": air_payload,
            },
            image,
        )
    )

    kr_usd = krw_to_usd(krw, kr_rate)
    kr_payload = {
        **air_payload,
        "shop": "feedle_kr",
        "usd_rate_used": kr_rate,
        "usd_rate_source": kr_rate_source,
        "note": (
            "www.feedle.me currently redirects to air.feedle.me. "
            "This row is the native KRW ask from the same public catalog."
        ),
    }
    rows.append(
        (
            {
                "platform": "feedle_kr",
                "external_id": external_id,
                "title": title,
                "description": None,
                "price": krw,
                "price_usd_equivalent": kr_usd,
                "currency": "KRW",
                "seller_name": seller,
                "seller_location": "Korea",
                "url": url,
                "traits_raw": traits_raw,
                "species": CRESTED_SPECIES,
                "last_seen_at": observed,
                "payload": kr_payload,
            },
            image,
        )
    )
    return rows


def scrape_feedle(limit_pages: int) -> list[tuple[dict[str, Any], Optional[str]]]:
    log("GET https://air.feedle.me/ (SSR bootstrap)")
    home = polite_get(FEEDLE_ORIGIN + "/")
    html = home.text
    action_id = discover_feedle_action_id(html)
    air_rate = discover_feedle_rate(html)
    crested_code = discover_feedle_crested_code(html)
    market_rate = frankfurter_usd_krw()
    kr_rate = market_rate or air_rate
    kr_rate_source = "frankfurter" if market_rate else "feedle_ssr"
    log(
        f"feedle action={action_id[:12]}... air_rate={air_rate} "
        f"kr_rate={kr_rate} ({kr_rate_source}) crested_code={crested_code}"
    )
    if air_rate is None:
        log(
            "WARN no Feedle SSR FX rate; feedle_air USD asks will be null "
            "rather than treating KRW as USD"
        )

    collected: list[tuple[dict[str, Any], Optional[str]]] = []
    seen_ids: set[str] = set()
    for sold_flag in (None, True):
        # First pass is the default catalog (for sale). The second asks for
        # sold listings, which gives Korea real sale prices; if Feedle
        # ignores the flag, already-seen ids stop it after one page.
        got = _feedle_pages(
            action_id,
            crested_code,
            sold_flag,
            limit_pages,
            seen_ids,
            collected,
            air_rate=air_rate,
            kr_rate=kr_rate,
            kr_rate_source=kr_rate_source,
        )
        log(f"feedle pass sold={sold_flag}: {got} new pets")
    log(
        f"feedle done: unique pets={len(seen_ids)} "
        f"rows={len(collected)} (air+kr)"
    )
    return collected


def _feedle_pages(
    action_id: str,
    crested_code: str,
    sold_flag: Optional[bool],
    limit_pages: int,
    seen_ids: set[str],
    collected: list[tuple[dict[str, Any], Optional[str]]],
    *,
    air_rate: Optional[float],
    kr_rate: Optional[float],
    kr_rate_source: str,
) -> int:
    added = 0
    cursor: Optional[str] = None
    for page in range(1, limit_pages + 1):
        payload: dict[str, Any] = {
            "sort": None,
            "sold": sold_flag,
            "species": crested_code,
            "sex": None,
            "size": [],
            "minPrice": None,
            "maxPrice": None,
            "traitList": [],
            "lineage": None,
        }
        if cursor:
            payload["createdAtCursor"] = cursor
        log(f"POST getPetList page={page} cursor={cursor or 'start'}")
        try:
            result = feedle_get_pet_list(action_id, payload)
        except Exception as exc:  # noqa: BLE001
            log(f"ERROR getPetList page {page}: {exc}")
            break
        pets = result.get("data") or []
        count = result.get("count")
        log(f"  n={len(pets)} count={count}")
        if not pets:
            break
        new_on_page = 0
        for pet in pets:
            if not isinstance(pet, dict):
                continue
            pid = str(pet.get("id") or "")
            if not pid or pid in seen_ids:
                continue
            seen_ids.add(pid)
            new_on_page += 1
            added += 1
            collected.extend(
                build_feedle_rows(
                    pet,
                    air_rate=air_rate,
                    kr_rate=kr_rate,
                    kr_rate_source=kr_rate_source,
                )
            )
        last = pets[-1] if isinstance(pets[-1], dict) else {}
        next_cursor = last.get("created_at_cursor")
        if not next_cursor or next_cursor == cursor or new_on_page == 0:
            break
        cursor = str(next_cursor)
        time.sleep(page_sleep())
    return added


# ---------------------------------------------------------------------------
# Korean breeder shops (Cafe24)
# ---------------------------------------------------------------------------

# (slug, shop name, list URL with {page}). Category pages where the shop
# has a crested gecko category; otherwise the shop's product search.
KR_SHOPS: tuple[tuple[str, str, str], ...] = (
    ("geckovillage", "Gecko Village", "https://geckovillage.co.kr/product/list.html?cate_no=76&page={page}"),
    ("newrun", "New Run Reptile", "https://newrunreptile.co.kr/product/list.html?cate_no=197&page={page}"),
    ("thezoo", "The Zoo", "https://xn--9m1b023b.com/product/list.html?cate_no=90&page={page}"),
    ("jbr", "Jungbreu Insect Harmony", "https://xn--699at5i1sh8pu9yi.com/product/list.html?cate_no=162&page={page}"),
    ("crepax", "Crepax", "https://crepax.kr/product/search.html?keyword=%ED%81%AC%EB%A0%88%EC%8A%A4%ED%8B%B0%EB%93%9C&page={page}"),
)
KR_SHOP_MAX_PAGES = 20


def scrape_kr_shops(limit_pages: int) -> list[tuple[dict[str, Any], Optional[str]]]:
    collected: list[tuple[dict[str, Any], Optional[str]]] = []
    observed = now_iso()
    for slug, shop, template in KR_SHOPS:
        seen: set[str] = set()
        kept = skipped = 0
        for page in range(1, min(limit_pages, KR_SHOP_MAX_PAGES) + 1):
            url = template.format(page=page)
            log(f"GET {url}")
            try:
                html = polite_get(url).text
            except Exception as exc:  # noqa: BLE001
                log(f"WARN {shop} page {page}: {exc}")
                break
            items = [i for i in parse_cafe24_list(html, url) if i["product_no"] not in seen]
            if not items:
                break
            for item in items:
                seen.add(item["product_no"])
                flags = kr_listing_flags(item["name"])
                if not flags["is_animal"] or not item["price_krw"]:
                    skipped += 1
                    continue
                kept += 1
                collected.append(
                    (
                        {
                            "platform": "kr_shops",
                            "external_id": f"{slug}:{item['product_no']}",
                            "title": item["name"],
                            "description": None,
                            "price": item["price_krw"],
                            "price_usd_equivalent": None,
                            "currency": "KRW",
                            "seller_name": shop,
                            "seller_location": "Korea",
                            "url": item["url"],
                            "traits_raw": item["name"],
                            "species": CRESTED_SPECIES,
                            "last_seen_at": observed,
                            "payload": {
                                "shop": slug,
                                "sold": item["sold_out"],
                                "sex": flags["sex"],
                                "is_group_lot": flags["is_group_lot"],
                                "exclude_from_combo_arb": flags["is_group_lot"],
                                "fetch_method": "cafe24_list",
                            },
                        },
                        None,
                    )
                )
            time.sleep(page_sleep())
        log(f"{shop}: kept {kept}, skipped {skipped} (supplies or unpriced)")
    return collected


# ---------------------------------------------------------------------------
# terraristik.com (Europe)
# ---------------------------------------------------------------------------

TERRA_SEARCH = "https://www.terraristik.com/tb/buy-and-sell/all-herp-ads/01/"
TERRA_TERMS = ("Correlophus ciliatus", "crested gecko", "Kronengecko")
TERRA_MAX_ADS = int(os.environ.get("TERRA_MAX_ADS", "300"))
TERRA_AD_SLEEP_S = max(1.0, float(os.environ.get("TERRA_AD_SLEEP_S", "1.5")))


def scrape_terraristik(limit_pages: int) -> list[tuple[dict[str, Any], Optional[str]]]:
    ads: dict[str, str] = {}
    for term in TERRA_TERMS:
        for page in range(min(limit_pages, 15)):
            params = {"ftsearch": term}
            if page:
                params["split"] = str(page * 10)
            log(f"GET terraristik search '{term}' split={page * 10}")
            try:
                html = polite_get(TERRA_SEARCH, params=params).text
            except Exception as exc:  # noqa: BLE001
                log(f"WARN terraristik search: {exc}")
                break
            found = [a for a in parse_terraristik_search(html) if a[0] not in ads]
            if not found:
                break
            ads.update(found)
            time.sleep(page_sleep())
    log(f"terraristik: {len(ads)} ads found, reading up to {TERRA_MAX_ADS}")
    collected: list[tuple[dict[str, Any], Optional[str]]] = []
    observed = now_iso()
    skipped = {"not_crested": 0, "wanted": 0, "error": 0}
    for ad_id, url in list(ads.items())[:TERRA_MAX_ADS]:
        try:
            ad = parse_terraristik_ad(polite_get(url).text)
        except Exception as exc:  # noqa: BLE001
            log(f"WARN terraristik ad {ad_id}: {exc}")
            skipped["error"] += 1
            continue
        finally:
            time.sleep(TERRA_AD_SLEEP_S)
        if not ad["is_crested"]:
            skipped["not_crested"] += 1
            continue
        if ad["wanted"]:
            skipped["wanted"] += 1
            continue
        # One clear price per ad is comparable; ads listing several animals
        # at several prices keep their prices in the payload only.
        exclude = ad["multi_price"] or ad["mixed_species"] or is_group_lot_text(ad["title"])
        collected.append(
            (
                {
                    "platform": "terraristik",
                    "external_id": ad_id,
                    "title": ad["title"],
                    "description": ad["text"][:2000],
                    "price": ad["price_eur"],
                    "price_usd_equivalent": None,
                    "currency": "EUR",
                    "seller_name": None,
                    "seller_location": ad["place"],
                    "url": url,
                    "traits_raw": ad["title"],
                    "species": CRESTED_SPECIES,
                    "last_seen_at": observed,
                    "payload": {
                        "posted": ad["posted"],
                        "prices": ad["prices"],
                        "multi_price": ad["multi_price"],
                        "mixed_species": ad["mixed_species"],
                        "is_group_lot": exclude,
                        "exclude_from_combo_arb": exclude,
                        "sold": False,
                        "fetch_method": "terraristik_ad_page",
                    },
                },
                None,
            )
        )
    log(f"terraristik: kept {len(collected)}, skipped {skipped}")
    return collected


# ---------------------------------------------------------------------------
# Exchange rates and daily price snapshots
# ---------------------------------------------------------------------------

FX_CURRENCIES = ("KRW", "EUR", "GBP", "CAD", "JPY")


def update_fx_rates(supabase) -> dict[str, float]:
    """Store units-per-USD for each tracked currency. The site converts with these."""
    try:
        resp = polite_get(
            FRANKFURTER,
            params={"from": "USD", "to": ",".join(FX_CURRENCIES)},
        )
        rates = parse_frankfurter(resp.json(), FX_CURRENCIES)
    except Exception as exc:  # noqa: BLE001
        log(f"WARN exchange rates: {exc}")
        return {}
    if rates and supabase is not None:
        rows = [
            {"currency": cur, "per_usd": rate, "as_of": now_iso(), "source": "frankfurter"}
            for cur, rate in rates.items()
        ]
        try:
            supabase.table("fx_rates").upsert(rows, on_conflict="currency").execute()
            log(f"exchange rates stored: {rates}")
        except Exception as exc:  # noqa: BLE001
            log(f"WARN exchange rate write: {exc}")
    return rates


def record_observations(supabase, pairs: list[tuple[dict[str, Any], Optional[str]]]) -> None:
    """One row per listing per day, so every market gets a price history."""
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    rows = []
    for row, _image in pairs:
        if row.get("platform") == "feedle_air":
            continue  # same animals as feedle_kr, kept once in native KRW
        payload = row.get("payload") or {}
        rows.append(
            {
                "platform": row["platform"],
                "external_id": str(row["external_id"]),
                "observed_on": today,
                "price": row.get("price"),
                "currency": row.get("currency"),
                "sold": bool(payload.get("sold")),
            }
        )
    for i in range(0, len(rows), 500):
        try:
            supabase.table("cross_platform_observations").upsert(
                rows[i : i + 500], on_conflict="platform,external_id,observed_on"
            ).execute()
        except Exception as exc:  # noqa: BLE001
            log(f"WARN observations write: {exc}")


# ---------------------------------------------------------------------------
# TikisGeckos (Shopify)
# ---------------------------------------------------------------------------


def scrape_tikis(limit_pages: int) -> list[tuple[dict[str, Any], Optional[str]]]:
    collected: list[tuple[dict[str, Any], Optional[str]]] = []
    for page in range(1, limit_pages + 1):
        url = TIKIS_PRODUCTS
        log(f"GET {url} page={page}")
        resp = polite_get(url, params={"limit": 250, "page": page})
        products = (resp.json() or {}).get("products") or []
        log(f"  n={len(products)}")
        if not products:
            break
        for product in products:
            if not isinstance(product, dict):
                continue
            title = str(product.get("title") or "")
            ptype = str(product.get("product_type") or "")
            tags = product.get("tags") if isinstance(product.get("tags"), list) else []
            body = str(product.get("body_html") or "")
            # Species and merch from title/type/tags only. Product body often
            # mentions shipping, diet, or the shop name and would false-flag.
            head_parts = [title, ptype, " ".join(str(t) for t in tags)]
            if OTHER_SPECIES_RE.search(f"{title} {ptype}"):
                continue
            if is_merch_text(*head_parts):
                continue
            if not is_crested_text(*head_parts):
                continue
            external_id = str(product.get("id") or "")
            if not external_id:
                continue
            handle = str(product.get("handle") or "")
            listing_url = f"https://tikisgeckos.com/products/{handle}" if handle else None
            price = shopify_price_usd(product)
            available = shopify_available(product)
            group_lot = is_group_lot_text(title, ptype, " ".join(str(t) for t in tags))
            skip_combo = exclude_from_combo_arb(title, ptype, " ".join(str(t) for t in tags))
            images = product.get("images") or []
            image = None
            if images and isinstance(images[0], dict):
                src = images[0].get("src")
                if isinstance(src, str) and src.startswith("http"):
                    image = src
            traits_raw = traits_csv([title, tags])
            payload = {
                "sex": None,
                "size": None,
                "lineage": None,
                "sold": not available,
                "qty": 1 if available else 0,
                "images": [image] if image else [],
                "source_url": listing_url,
                "shop": "tikis_geckos",
                "is_group_lot": group_lot,
                "exclude_from_combo_arb": skip_combo,
                "product_type": ptype,
                "tags": tags,
                "vendor": product.get("vendor"),
                "handle": handle,
                # Catalog browsing is documented for agents, but this is not
                # a license to reuse product photography as ML ground truth.
                "catalog_access": "agent_read_only",
                "training_rights": "permission_required",
                "training_eligible": False,
            }
            collected.append(
                (
                    {
                        "platform": "tikis_geckos",
                        "external_id": external_id,
                        "title": title,
                        "description": re.sub(r"<[^>]+>", " ", body)[:2000] or None,
                        "price": price,
                        "price_usd_equivalent": price,
                        "currency": "USD",
                        "seller_name": "TikisGeckos",
                        "seller_location": "Florida US",
                        "url": listing_url,
                        "traits_raw": traits_raw,
                        "species": CRESTED_SPECIES,
                        "last_seen_at": now_iso(),
                        "payload": payload,
                    },
                    image,
                )
            )
        if len(products) < 250:
            break
        time.sleep(page_sleep())
    log(f"tikis done: crested rows={len(collected)}")
    return collected


# ---------------------------------------------------------------------------
# Altitude Exotics (Squarespace)
# ---------------------------------------------------------------------------


def scrape_altitude(limit_pages: int) -> list[tuple[dict[str, Any], Optional[str]]]:
    del limit_pages  # Squarespace embeds the full product list in one shop page.
    log(f"GET {ALTITUDE_SHOP}")
    data = squarespace_product_payload(polite_get(ALTITUDE_SHOP).text)
    items = data.get("items") or []
    log(f"  n={len(items)}")
    category_labels = squarespace_category_labels(data)
    collected: list[tuple[dict[str, Any], Optional[str]]] = []
    skipped_non_crested = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        if not altitude_item_is_crested(item, category_labels):
            skipped_non_crested += 1
            continue
        title = str(item.get("title") or "")
        excerpt = str(item.get("excerpt") or "")
        body = str(item.get("body") or "")
        fields = parse_excerpt_fields(excerpt)
        morph = fields.get("morph") or ""
        blob_parts = [title, excerpt, body, morph]
        is_hatchling_sku = bool(
            re.search(r"hand-?picked hatchling", title, re.IGNORECASE)
        )
        external_id = str(item.get("id") or "")
        if not external_id:
            continue
        path = str(item.get("fullUrl") or "")
        listing_url = urljoin("https://www.altitudeexotics.com", path)
        price = squarespace_price_usd(item)
        qty = squarespace_qty(item)
        sold_out = qty == 0
        group_lot = is_group_lot_text(*blob_parts)
        skip_combo = (
            is_hatchling_sku
            or exclude_from_combo_arb(*blob_parts)
        )
        image = item.get("assetUrl")
        if not (isinstance(image, str) and image.startswith("http")):
            image = None
        traits_raw = traits_csv([morph, title] if morph else [title])
        category_ids = item.get("categoryIds")
        if not isinstance(category_ids, list):
            category_ids = []
        payload = {
            "sex": fields.get("sex"),
            "size": fields.get("weight"),
            "lineage": fields.get("lineage"),
            "sold": sold_out,
            "qty": qty,
            "images": [image] if image else [],
            "source_url": listing_url,
            "shop": "altitude_exotics",
            "is_group_lot": group_lot,
            "exclude_from_combo_arb": skip_combo,
            "morph": morph,
            "excerpt_fields": fields,
            "sku_title": title,
            "product_type": item.get("productType"),
            "category_ids": category_ids,
            "category_labels": [
                category_labels.get(str(category_id), "")
                for category_id in category_ids
                if category_labels.get(str(category_id))
            ],
            "catalog_access": "robots_allowed_html",
            "training_rights": "permission_required",
            "training_eligible": False,
        }
        collected.append(
            (
                {
                    "platform": "altitude_exotics",
                    "external_id": external_id,
                    "title": f"{title} {morph}".strip() if morph else title,
                    "description": re.sub(r"<[^>]+>", " ", excerpt)[:2000] or None,
                    "price": price,
                    "price_usd_equivalent": price,
                    "currency": "USD",
                    "seller_name": "Altitude Exotics",
                    "seller_location": "Colorado US",
                    "url": listing_url,
                    "traits_raw": traits_raw,
                    "species": CRESTED_SPECIES,
                    "last_seen_at": now_iso(),
                    "payload": payload,
                },
                image,
            )
        )
    log(
        f"altitude done: crested rows={len(collected)} "
        f"skipped non-crested={skipped_non_crested}"
    )
    return collected


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------


def existing_first_seen(
    supabase,
    platform: str,
    external_ids: list[str],
) -> dict[str, str]:
    found: dict[str, str] = {}
    for i in range(0, len(external_ids), 200):
        chunk = external_ids[i : i + 200]
        result = (
            supabase.table("cross_platform_listings")
            .select("external_id, first_seen_at")
            .eq("platform", platform)
            .in_("external_id", chunk)
            .execute()
        )
        for row in result.data or []:
            if row.get("external_id") and row.get("first_seen_at"):
                found[str(row["external_id"])] = str(row["first_seen_at"])
    return found


def upsert_rows(
    supabase,
    pairs: list[tuple[dict[str, Any], Optional[str]]],
) -> tuple[int, int]:
    """Upsert listings then first-image URLs. Returns (succeeded, failed)."""
    succeeded = 0
    failed = 0
    by_platform: dict[str, list[tuple[dict[str, Any], Optional[str]]]] = {}
    for row, image in pairs:
        by_platform.setdefault(str(row["platform"]), []).append((row, image))

    for platform, group in by_platform.items():
        ids = [str(row["external_id"]) for row, _ in group]
        first_seen = existing_first_seen(supabase, platform, ids)
        observed = now_iso()
        for i in range(0, len(group), UPSERT_BATCH):
            batch = group[i : i + UPSERT_BATCH]
            payload_rows = []
            for row, _image in batch:
                ext = str(row["external_id"])
                payload_rows.append(
                    {
                        **row,
                        "first_seen_at": first_seen.get(ext, observed),
                    }
                )
            try:
                result = (
                    supabase.table("cross_platform_listings")
                    .upsert(payload_rows, on_conflict="platform,external_id")
                    .execute()
                )
                written = result.data or []
                succeeded += len(written) if written else len(payload_rows)
            except Exception as exc:  # noqa: BLE001
                log(f"ERROR upsert {platform} batch {i}: {exc}")
                failed += len(payload_rows)
                continue

            # Map external_id -> uuid for image rows.
            returned = {
                str(r["external_id"]): r["id"]
                for r in (result.data or [])
                if r.get("external_id") and r.get("id")
            }
            if len(returned) < len(payload_rows):
                lookup = (
                    supabase.table("cross_platform_listings")
                    .select("id, external_id")
                    .eq("platform", platform)
                    .in_("external_id", [r["external_id"] for r in payload_rows])
                    .execute()
                )
                for rec in lookup.data or []:
                    returned[str(rec["external_id"])] = rec["id"]

            images = []
            for row, image in batch:
                parent = returned.get(str(row["external_id"]))
                if not parent or not image:
                    continue
                images.append(
                    {
                        "cross_platform_listing_id": parent,
                        "image_url": image,
                        "storage_bucket": "listing-images",
                        "uploaded_at": observed,
                    }
                )
            for j in range(0, len(images), IMAGE_BATCH):
                try:
                    supabase.table("cross_platform_listing_images").upsert(
                        images[j : j + IMAGE_BATCH],
                        on_conflict="cross_platform_listing_id,image_url",
                    ).execute()
                except Exception as exc:  # noqa: BLE001
                    log(f"WARN image upsert {platform}: {exc}")
    return succeeded, failed


def print_dry_run(pairs: list[tuple[dict[str, Any], Optional[str]]]) -> None:
    by_platform: dict[str, list[dict[str, Any]]] = {}
    for row, _image in pairs:
        by_platform.setdefault(str(row["platform"]), []).append(row)
    print("\n=== dry-run counts ===")
    for platform, rows in sorted(by_platform.items()):
        priced = sum(1 for r in rows if r.get("price"))
        group = sum(
            1
            for r in rows
            if isinstance(r.get("payload"), dict) and r["payload"].get("is_group_lot")
        )
        crested = sum(1 for r in rows if r.get("species") == "crested")
        print(
            f"  {platform:20} n={len(rows):5} crested={crested:5} "
            f"priced={priced:5} group_lot={group:4}"
        )
    print("\n=== sample rows ===")
    for platform, rows in sorted(by_platform.items()):
        print(f"\n-- {platform} --")
        for row in rows[:3]:
            sample = {
                "external_id": row.get("external_id"),
                "title": row.get("title"),
                "price": row.get("price"),
                "currency": row.get("currency"),
                "price_usd_equivalent": row.get("price_usd_equivalent"),
                "url": row.get("url"),
                "traits_raw": row.get("traits_raw"),
                "species": row.get("species"),
                "is_group_lot": (row.get("payload") or {}).get("is_group_lot"),
                "usd_rate_used": (row.get("payload") or {}).get("usd_rate_used"),
            }
            print(json.dumps(sample, ensure_ascii=True, default=str))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

SOURCES = ("all", "feedle_air", "feedle_kr", "tikis", "altitude", "kr_shops", "terraristik")


def apply_cli_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        choices=SOURCES,
        default="all",
        help="Which public catalog to walk",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and print counts; do not write to Supabase",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="Override MAX_PAGES for this run",
    )
    args = parser.parse_args(argv)
    if args.max_pages is not None:
        os.environ["MAX_PAGES"] = str(max(1, args.max_pages))
    return args


def collect(source: str, pages: int) -> list[tuple[dict[str, Any], Optional[str]]]:
    want_feedle = source in ("all", "feedle_air", "feedle_kr")
    want_tikis = source in ("all", "tikis")
    want_altitude = source in ("all", "altitude")
    want_kr_shops = source in ("all", "kr_shops")
    want_terra = source in ("all", "terraristik")
    pairs: list[tuple[dict[str, Any], Optional[str]]] = []
    if want_feedle:
        feedle_pairs = scrape_feedle(pages)
        if source == "feedle_air":
            feedle_pairs = [p for p in feedle_pairs if p[0]["platform"] == "feedle_air"]
        elif source == "feedle_kr":
            feedle_pairs = [p for p in feedle_pairs if p[0]["platform"] == "feedle_kr"]
        pairs.extend(feedle_pairs)
    if want_tikis:
        pairs.extend(scrape_tikis(pages))
    if want_altitude:
        pairs.extend(scrape_altitude(pages))
    # Each source is independent: one site being down must not stop the rest.
    for wanted, fn, name in (
        (want_kr_shops, scrape_kr_shops, "kr_shops"),
        (want_terra, scrape_terraristik, "terraristik"),
    ):
        if not wanted:
            continue
        try:
            pairs.extend(fn(pages))
        except Exception as exc:  # noqa: BLE001
            log(f"ERROR {name}: {exc}")
    return pairs


def run_group(
    supabase,
    scrape_type: str,
    pairs: list[tuple[dict[str, Any], Optional[str]]],
    dry_run: bool,
) -> tuple[int, int, int]:
    attempted = len(pairs)
    if dry_run:
        return attempted, 0, 0
    run_id = start_scrape_run(supabase, scrape_type)
    try:
        succeeded, failed = upsert_rows(supabase, pairs)
        status = "success"
        if failed and succeeded:
            status = "partial"
        elif failed and not succeeded:
            status = "failed"
        finalise_scrape_run(
            supabase,
            run_id,
            status=status,
            attempted=attempted,
            succeeded=succeeded,
            failed=failed,
        )
        return attempted, succeeded, failed
    except Exception as exc:
        finalise_scrape_run(
            supabase,
            run_id,
            status="failed",
            attempted=attempted,
            succeeded=0,
            failed=attempted,
            error_message=str(exc)[:500],
        )
        raise


def main() -> int:
    args = apply_cli_args()
    pages = max_pages()
    log(
        f"cross-platform ingest source={args.source} dry_run={args.dry_run} "
        f"max_pages={pages} ua={USER_AGENT}"
    )
    try:
        pairs = collect(args.source, pages)
    except Exception:
        log("ERROR while fetching public catalogs")
        traceback.print_exc()
        return 1

    print_dry_run(pairs)

    if args.dry_run:
        log("dry-run: no writes")
        return 0 if pairs else 2

    from lib.supabase_client import get_supabase

    supabase = get_supabase()
    update_fx_rates(supabase)
    groups = (
        ("cross_platform_feedle", ("feedle_air", "feedle_kr"), args.source in ("all", "feedle_air", "feedle_kr")),
        ("cross_platform_shops", ("tikis_geckos", "altitude_exotics"), args.source in ("all", "tikis", "altitude")),
        ("cross_platform_kr_shops", ("kr_shops",), args.source in ("all", "kr_shops")),
        ("cross_platform_terraristik", ("terraristik",), args.source in ("all", "terraristik")),
    )
    exit_code = 0
    for scrape_type, platforms, wanted in groups:
        if not wanted:
            continue
        group = [p for p in pairs if p[0]["platform"] in platforms]
        if not group:
            # A source that returns nothing is broken, not quiet. Record it
            # so the Data status page shows it instead of going silent.
            record_empty_run(supabase, scrape_type)
            exit_code = 1
            continue
        try:
            run_group(supabase, scrape_type, group, False)
            record_observations(supabase, group)
        except Exception:
            traceback.print_exc()
            exit_code = 1
    return exit_code


def record_empty_run(supabase, scrape_type: str) -> None:
    run_id = start_scrape_run(supabase, scrape_type)
    finalise_scrape_run(
        supabase,
        run_id,
        status="failed",
        attempted=0,
        succeeded=0,
        failed=0,
        error_message="source returned no listings; see the job log",
    )


if __name__ == "__main__":
    sys.exit(main())
