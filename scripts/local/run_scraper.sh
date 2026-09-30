#!/bin/zsh
# Runs the MorphMarket scrape from this Mac.
#
# Why a Mac: MorphMarket blocks requests from GitHub's servers (HTTP 403
# on every run since late August 2026). A home internet connection is not
# blocked, so the scrape runs here instead. launchd starts the catalog
# recrawl every morning and the newest check every 30 minutes (see
# setup_mac.sh); you can also run it by hand:
#
#   scripts/local/run_scraper.sh            full catalog recrawl
#   scripts/local/run_scraper.sh windowed   only listings from the last 7 days
#   scripts/local/run_scraper.sh newest     only the newest listings (a
#                                           minute or less)
#
# What it does, in order:
#   1. Pulls the latest code from GitHub so fixes arrive on their own.
#   2. Keeps the Python packages in sync with requirements.txt.
#      (The newest check skips 1 and 2 to stay quick; the morning run
#      keeps the code current.)
#   3. Runs scrape_listings_api.py. It records the run in scrape_runs, so
#      the website's Data status page shows whether it worked, and after a
#      run that wrote rows it asks the database to refresh the market
#      views and run the watchlist matcher.
#   4. Refreshes the combo price index (not for the newest check).
#   5. Reads a slice of old listings for the past-year history
#      (backfill_history.py, catalog runs only). Each day reads
#      BACKFILL_DAILY_IDS more (default 4000, about 30 minutes) until the
#      year is filled in, then it finishes in seconds.
#      BACKFILL_DAILY_IDS=0 turns it off.
#   6. Posts to Discord if the scrape failed and DISCORD_OPS_WEBHOOK is set
#      (not for the newest check, which would post every 30 minutes while
#      the Mac is offline).
# The Mac is kept awake while it runs.

set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_PREFIX="[geck-scraper $(date '+%Y-%m-%d %H:%M:%S')]"
MODE="${1:-catalog}"

say() { echo "$LOG_PREFIX $*"; }

cd "$REPO" || exit 1

# Settings live in .env.local at the repo root (never committed).
if [ -f "$REPO/.env.local" ]; then
  set -a
  . "$REPO/.env.local"
  set +a
fi
export SUPABASE_DB_SCHEMA="${SUPABASE_DB_SCHEMA:-geck_data}"
export TRIGGERED_BY="${TRIGGERED_BY:-mac_${MODE}}"

if [ "$MODE" = "newest" ]; then
  # launchd appends to this log every 30 minutes and never trims it, so
  # keep the last 2,000 lines. Rewriting the same file (not replacing it)
  # keeps launchd's open handle valid.
  NEWEST_LOG="$HOME/Library/Logs/geck-scraper-newest.log"
  if [ -f "$NEWEST_LOG" ] && [ "$(wc -c < "$NEWEST_LOG")" -gt 2000000 ]; then
    tail -n 2000 "$NEWEST_LOG" > "$NEWEST_LOG.tmp" && cat "$NEWEST_LOG.tmp" > "$NEWEST_LOG"
    rm -f "$NEWEST_LOG.tmp"
  fi
else
  say "updating code"
  git -C "$REPO" pull --ff-only --quiet 2>&1 || say "git pull skipped (local changes or offline); using current code"
fi

PY="$REPO/scripts/.venv/bin/python"
if [ ! -x "$PY" ]; then
  say "Python environment missing. Run scripts/local/setup_mac.sh first."
  exit 1
fi
if [ "$MODE" != "newest" ]; then
  "$PY" -m pip install --quiet --disable-pip-version-check -r "$REPO/scripts/requirements.txt" \
    || say "pip install had a problem; trying the scrape anyway"
fi

cd "$REPO/scripts" || exit 1
say "starting scrape (mode=$MODE)"
caffeinate -i "$PY" scrape_listings_api.py --mode="$MODE"
STATUS=$?
say "scrape finished with exit code $STATUS"

# The market views are not refreshed here: the scraper already asked the
# database to do it (the full refresh takes about a minute, longer than
# this key may run one query).
if [ "$MODE" != "newest" ]; then
  say "refreshing the combo price index"
  "$PY" - <<'PY'
from lib.supabase_client import get_supabase

try:
    get_supabase().rpc("refresh_combo_index_daily", {}).execute()
    print("refreshed refresh_combo_index_daily", flush=True)
except Exception as exc:  # noqa: BLE001
    # The nightly index job rebuilds it anyway, so a failure here only
    # delays the price index by a day.
    print(f"WARN refresh_combo_index_daily: {exc}", flush=True)
PY
fi

BACKFILL_DAILY_IDS="${BACKFILL_DAILY_IDS:-4000}"
if [ "$MODE" = "catalog" ] && [ "$BACKFILL_DAILY_IDS" -gt 0 ]; then
  say "reading up to $BACKFILL_DAILY_IDS old listings for the past-year history"
  # A failure here never affects the scrape's exit code; tomorrow's run
  # picks up where this one stopped.
  caffeinate -i "$PY" backfill_history.py --max-ids "$BACKFILL_DAILY_IDS" \
    || say "history backfill stopped early; it resumes tomorrow"
fi

if [ "$STATUS" -ne 0 ] && [ "$MODE" != "newest" ] && [ -n "${DISCORD_OPS_WEBHOOK:-}" ]; then
  curl -sS -m 20 -H "Content-Type: application/json" \
    -d "{\"content\": \"Geck Data Mac scrape ($MODE) failed with exit code $STATUS. Log: ~/Library/Logs/geck-scraper.log\"}" \
    "$DISCORD_OPS_WEBHOOK" >/dev/null || true
fi

exit "$STATUS"
