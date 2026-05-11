"""
Shared Supabase client setup for every Python script in this folder.

Why a wrapper instead of calling supabase.create_client() directly in each
script?
  1. One place to validate env vars (fail fast with a clear error if the
     SUPABASE_URL or SUPABASE_SERVICE_KEY is missing or obviously wrong).
  2. One place to load .env.local during local development so every script
     behaves the same whether it is run by hand or by GitHub Actions.
  3. Easier to swap the client implementation later (e.g. if we wanted to
     use a connection pool or a different SDK) without touching every
     script.

The service role key bypasses RLS, which is what the scripts need. Never
commit this key, never expose it to the browser.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from supabase import Client, create_client


def _load_dotenv_if_present() -> None:
    """Load .env.local from the repo root when running locally.

    GitHub Actions injects env vars directly so dotenv is a no-op there. We
    do not fail if python-dotenv is missing because the runtime in CI does
    not need it.
    """
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return

    repo_root = Path(__file__).resolve().parents[2]
    for candidate in (repo_root / ".env.local", repo_root / ".env"):
        if candidate.exists():
            load_dotenv(candidate, override=False)
            return


def get_supabase() -> Client:
    """Return a Supabase client authenticated with the service role key.

    Looks for env vars in this order, accepting either naming so the same
    .env.local works for both the Next.js app and these scripts:
      SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
      SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY
    """
    _load_dotenv_if_present()

    url = os.environ.get("SUPABASE_URL") or os.environ.get(
        "NEXT_PUBLIC_SUPABASE_URL"
    )
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY"
    )

    if not url:
        sys.exit(
            "ERROR: SUPABASE_URL is not set. Put it in .env.local or export it "
            "before running this script."
        )
    if not key:
        sys.exit(
            "ERROR: SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not "
            "set. Find it in Supabase dashboard > Project Settings > API > "
            "service_role secret."
        )
    if "supabase.co" not in url:
        sys.exit(
            f"ERROR: SUPABASE_URL does not look like a Supabase URL: {url!r}"
        )

    return create_client(url, key)


def get_supabase_url() -> str:
    """Return the base Supabase URL (used to build public storage URLs)."""
    _load_dotenv_if_present()
    url = os.environ.get("SUPABASE_URL") or os.environ.get(
        "NEXT_PUBLIC_SUPABASE_URL"
    )
    if not url:
        sys.exit("ERROR: SUPABASE_URL is not set.")
    return url.rstrip("/")
