#!/bin/zsh
# Runs the MorphMarket catalog recrawl from this Mac.
#
# Why a Mac: MorphMarket blocks requests from GitHub's servers (HTTP 403
# on every run since late August 2026). A home internet connection is not
# blocked, so the daily scrape runs here instead. launchd starts this file
# every morning (see setup_mac.sh); you can also run it by hand:
#
#   scripts/local/run_scraper.sh            full catalog recrawl
#   scripts/local/run_scraper.sh windowed   only listings from the last 7 days
#
# What it does, in order:
#   1. Pulls the latest code from GitHub so fixes arrive on their own.
#   2. Keeps the Python packages in sync with requirements.txt.
#   3. Runs scrape_listings_api.py (it records the run in scrape_runs, so
#      the website's Data status page shows whether it worked).
#   4. Refreshes the market views so the website shows the new data.
#   5. Posts to Discord if it failed and DISCORD_OPS_WEBHOOK is set.
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

say "updating code"
git -C "$REPO" pull --ff-only --quiet 2>&1 || say "git pull skipped (local changes or offline); using current code"

PY="$REPO/scripts/.venv/bin/python"
if [ ! -x "$PY" ]; then
  say "Python environment missing. Run scripts/local/setup_mac.sh first."
  exit 1
fi
"$PY" -m pip install --quiet --disable-pip-version-check -r "$REPO/scripts/requirements.txt" \
  || say "pip install had a problem; trying the scrape anyway"

cd "$REPO/scripts" || exit 1
say "starting scrape (mode=$MODE)"
caffeinate -i "$PY" scrape_listings_api.py --mode="$MODE"
STATUS=$?
say "scrape finished with exit code $STATUS"

say "refreshing market views"
"$PY" - <<'PY'
from lib.supabase_client import get_supabase

sb = get_supabase()
for fn in ("refresh_combo_index_daily", "refresh_market_matviews"):
    try:
        sb.rpc(fn, {}).execute()
        print(f"refreshed {fn}", flush=True)
    except Exception as exc:  # noqa: BLE001
        # The hourly database job refreshes the market views anyway, so a
        # failure here only delays the website by up to an hour.
        print(f"WARN {fn}: {exc}", flush=True)
PY

if [ "$STATUS" -ne 0 ] && [ -n "${DISCORD_OPS_WEBHOOK:-}" ]; then
  curl -sS -m 20 -H "Content-Type: application/json" \
    -d "{\"content\": \"Geck Data Mac scrape ($MODE) failed with exit code $STATUS. Log: ~/Library/Logs/geck-scraper.log\"}" \
    "$DISCORD_OPS_WEBHOOK" >/dev/null || true
fi

exit "$STATUS"
