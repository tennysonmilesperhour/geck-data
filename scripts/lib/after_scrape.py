"""Ask the database to bring the market up to date after a scrape.

Why a request instead of refreshing here: refreshing every market view
takes about a minute, and the service role's statement timeout is 60
seconds, so a scraper that refreshed directly could time out at the end of
a good run. The request is one quick insert. A database job checks for
requests every 5 minutes, then refreshes the market views, updates the
day's market numbers and runs the watchlist matcher, so members hear about
matching listings soon after a scrape (geck_data.after_scrape, defined in
the Geck Inspect repo's supabase/migrations).

A source name that starts with "newest" asks for the quick path: only the
two listing views that the Market page's Live tape, the watchlists and the
morning brief read (about 2 seconds of database time). Every other source
asks for the full refresh, and a full check also updates each member's
collection value.
"""
from __future__ import annotations

import datetime as dt


def request_after_scrape(supabase, source: str) -> bool:
    """Queue a market refresh. Never raises.

    A failed request only delays the website until the hourly refresh, so
    it must not fail a scrape that already wrote its rows.
    """
    try:
        supabase.rpc("request_after_scrape", {"p_source": source}).execute()
    except Exception as exc:  # noqa: BLE001
        _log(
            f"WARN request_after_scrape({source}) failed: {exc}; "
            "the hourly refresh will catch up"
        )
        return False
    _log(f"asked the database to refresh the market (source={source})")
    return True


def _log(message: str) -> None:
    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {message}", flush=True)
