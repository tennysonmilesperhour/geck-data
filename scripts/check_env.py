"""
Preflight env check. Run BEFORE migrate_to_supabase.py or any scrape
script so you cannot accidentally write to the wrong Supabase project.

Usage:
  cd scripts
  python check_env.py

Exits 0 if everything looks healthy. Non-zero if any critical check
fails. The output is the source of truth: if it says you are connected
to "Geck Inspect" instead of "Geck Data", STOP.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.parse
from typing import Optional

import requests

from lib.supabase_client import get_supabase, get_supabase_url

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
DIM = "\033[2m"
RESET = "\033[0m"

GECK_DATA_HOST = "dhotmtgryuovkmsncdby.supabase.co"
GECK_INSPECT_HOST = "mmuglfphhwlaluyfyxsp.supabase.co"


def ok(msg: str) -> None:
    print(f"  {GREEN}OK{RESET}    {msg}")


def warn(msg: str) -> None:
    print(f"  {YELLOW}WARN{RESET}  {msg}")


def fail(msg: str) -> None:
    print(f"  {RED}FAIL{RESET}  {msg}")


def info(msg: str) -> None:
    print(f"  {DIM}info{RESET}  {msg}")


def heading(msg: str) -> None:
    print(f"\n=== {msg} ===")


def decode_jwt_role(token: str) -> Optional[str]:
    """Decode the role claim out of a Supabase JWT without verifying it."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        # Base64-url decode the payload. Pad to multiple of 4.
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        decoded = base64.urlsafe_b64decode(payload.encode())
        data = json.loads(decoded)
        return data.get("role")
    except Exception:  # noqa: BLE001
        return None


def check_supabase() -> int:
    heading("Supabase")
    failures = 0

    url = get_supabase_url()
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc
    project_ref = host.split(".")[0] if host else ""

    print(f"  URL:           {url}")
    print(f"  project_ref:   {project_ref}")

    if host == GECK_DATA_HOST:
        ok(f'connected to "Geck Data" ({project_ref})')
    elif host == GECK_INSPECT_HOST:
        fail(
            'connected to "Geck Inspect", NOT "Geck Data". '
            "Update SUPABASE_URL in .env.local."
        )
        failures += 1
    else:
        warn(
            f'host {host!r} is not the known Geck Data project. '
            f"Expected {GECK_DATA_HOST}."
        )

    # Inspect the service role key without printing it.
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY"
    )
    if not key:
        fail("no SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) in env")
        failures += 1
    else:
        role = decode_jwt_role(key)
        if role == "service_role":
            ok(f"key decodes as role={role}")
        elif role == "anon":
            fail(
                "key decodes as role=anon. The scripts need service_role to "
                "bypass RLS. Use the SECRET service_role key, not the anon "
                "key, from Supabase dashboard > Project Settings > API."
            )
            failures += 1
        else:
            warn(f"could not decode role from key (got: {role!r})")

    return failures


def check_schema(supabase) -> int:
    heading("Schema")
    failures = 0

    expected_tables = ("listings", "listings_history", "scrape_runs", "morphs")
    counts: dict[str, Optional[int]] = {}
    for table in expected_tables:
        try:
            resp = (
                supabase.table(table)
                .select("*", count="exact", head=True)
                .execute()
            )
            counts[table] = resp.count
            ok(f"{table}: {resp.count:,} rows")
        except Exception as exc:  # noqa: BLE001
            fail(f"{table}: {exc}")
            counts[table] = None
            failures += 1

    if (
        counts.get("listings") == 0
        and counts.get("listings_history") == 0
        and counts.get("scrape_runs") == 0
    ):
        warn(
            "all data tables empty. If you expected the CSV migration to "
            "have landed already, run migrate_to_supabase.py here."
        )

    # The three helper functions the scripts depend on. We test the two
    # we can call safely; mark_unseen_listings_inactive requires a real
    # scrape_runs.id so we just confirm the RPC stack is healthy.
    print()
    rpc_smoke_tests = (
        ("listings_needing_detail_scrape", {"stale_after_days": 9999}),
        ("listings_needing_image_download", {}),
    )
    for fn, params in rpc_smoke_tests:
        try:
            supabase.rpc(fn, params).execute()
            ok(f"{fn}: callable")
        except Exception as exc:  # noqa: BLE001
            fail(f"{fn}: {exc}")
            failures += 1
    info(
        "mark_unseen_listings_inactive: not directly tested here (requires a "
        "real scrape_runs.id). It is invoked from scrape_listings.py."
    )

    return failures


def check_storage(supabase) -> int:
    heading("Storage")
    failures = 0
    try:
        buckets = supabase.storage.list_buckets()
        names = []
        for b in buckets or []:
            name = getattr(b, "name", None) or (
                b.get("name") if isinstance(b, dict) else None
            )
            if name:
                names.append(name)
        if "listing-images" in names:
            ok(f"listing-images bucket present (all buckets: {names})")
        else:
            fail(
                f"listing-images bucket NOT found. Buckets present: {names}. "
                "Create it in Supabase dashboard > Storage > New bucket "
                "(make it public)."
            )
            failures += 1
    except Exception as exc:  # noqa: BLE001
        fail(f"could not list storage buckets: {exc}")
        failures += 1
    return failures


def check_decodo() -> int:
    heading("Decodo")
    auth = os.environ.get("DECODO_AUTH", "").strip()
    if not auth:
        warn(
            "DECODO_AUTH not set. Only required for scrape_listings.py and "
            "scrape_details.py; download_images.py and upload_local_images.py "
            "do not need it."
        )
        return 0

    # Normalise so we can show length without printing secrets.
    if not auth.lower().startswith("basic "):
        info("DECODO_AUTH does not start with 'Basic '. Wrapper will add it.")
        header = f"Basic {auth}"
    else:
        header = auth
    info(f"auth header length: {len(header)} chars")

    # Smoke test by issuing a tiny scrape job that should always succeed.
    try:
        resp = requests.post(
            "https://scraper-api.decodo.com/v2/scrape",
            headers={
                "Authorization": header,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={"url": "https://example.com", "geo": "United States"},
            timeout=30,
        )
    except requests.RequestException as exc:
        fail(f"network error contacting Decodo: {exc}")
        return 1

    if resp.status_code == 200:
        ok("Decodo auth works (200 from /v2/scrape against example.com)")
        return 0
    if resp.status_code in {401, 403}:
        fail(
            f"Decodo returned {resp.status_code}. Auth value is wrong. Copy "
            "the full Basic header from the Decodo dashboard."
        )
        return 1
    warn(f"Decodo returned {resp.status_code}: {resp.text[:200]}")
    return 0


def main() -> int:
    print("Geck Data preflight check")
    failures = 0

    failures += check_supabase()
    if failures:
        print(
            f"\n{RED}STOP{RESET}. Supabase env is wrong. Fix it before running "
            "scripts that write data."
        )
        return 1

    supabase = get_supabase()
    failures += check_schema(supabase)
    failures += check_storage(supabase)
    failures += check_decodo()

    print()
    if failures == 0:
        print(f"{GREEN}All checks passed.{RESET}")
        return 0
    print(f"{RED}{failures} check(s) failed.{RESET} Address them before scraping.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
