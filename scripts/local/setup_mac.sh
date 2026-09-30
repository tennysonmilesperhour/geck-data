#!/bin/zsh
# One-time setup for the MorphMarket scrape on this Mac.
#
#   scripts/local/setup_mac.sh               install or update
#   scripts/local/setup_mac.sh --daily-only  install the morning scrape but
#                                            not the 30-minute newest check
#   scripts/local/setup_mac.sh --uninstall   stop both schedules
#
# Safe to run again at any time. It will:
#   1. Check for Python 3.
#   2. Create scripts/.venv and install the scraper's packages and the
#      Chromium browser it uses to talk to MorphMarket.
#   3. Make sure .env.local has the Supabase settings (asks you for the
#      service key once if it is missing; the file is never committed).
#   4. Test that MorphMarket answers from this Mac (reads one listing,
#      writes nothing).
#   5. Schedule scripts/local/run_scraper.sh every day at 8:35am with
#      launchd, the Mac's built-in scheduler. If the Mac is asleep at
#      8:35, the run starts when it wakes up.
#   6. Schedule the newest check (run_scraper.sh newest) every 30
#      minutes. It reads only the newest listings, takes a minute or less,
#      and is what makes new crested listings show up on the Geck Inspect
#      Market page and in members' watchlists within the hour. While the
#      Mac sleeps it pauses, and it runs again when the Mac wakes.

set -eu
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.geckinspect.scraper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/geck-scraper.log"
LABEL_NEWEST="com.geckinspect.scraper-newest"
PLIST_NEWEST="$HOME/Library/LaunchAgents/$LABEL_NEWEST.plist"
LOG_NEWEST="$HOME/Library/Logs/geck-scraper-newest.log"
DOMAIN="gui/$(id -u)"
DAILY_ONLY=0
[ "${1:-}" = "--daily-only" ] && DAILY_ONLY=1

step() { echo; echo "==> $*"; }

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootout "$DOMAIN/$LABEL_NEWEST" 2>/dev/null || true
  rm -f "$PLIST" "$PLIST_NEWEST"
  echo "Both schedules removed. Nothing else was changed."
  exit 0
fi

if [ "$(uname)" != "Darwin" ]; then
  echo "This setup is for macOS." >&2
  exit 1
fi

step "Checking for Python 3"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed. Run: xcode-select --install" >&2
  echo "then run this script again." >&2
  exit 1
fi
python3 --version

step "Installing the scraper's Python packages (first time takes a few minutes)"
cd "$REPO/scripts"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements.txt
.venv/bin/python -m playwright install chromium

step "Checking Supabase settings in .env.local"
ENV_FILE="$REPO/.env.local"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
has() { grep -q "^$1=" "$ENV_FILE"; }
has SUPABASE_URL || echo "SUPABASE_URL=https://mmuglfphhwlaluyfyxsp.supabase.co" >> "$ENV_FILE"
has SUPABASE_DB_SCHEMA || echo "SUPABASE_DB_SCHEMA=geck_data" >> "$ENV_FILE"
if ! has SUPABASE_SERVICE_KEY && ! has SUPABASE_SERVICE_ROLE_KEY; then
  echo "Paste the Supabase service_role key (Supabase dashboard > Project Settings > API)."
  echo "It will not show on screen while you paste."
  read -rs "KEY?service_role key: "
  echo
  [ -n "$KEY" ] || { echo "No key entered." >&2; exit 1; }
  echo "SUPABASE_SERVICE_KEY=$KEY" >> "$ENV_FILE"
fi
echo ".env.local is ready (not committed to GitHub)."

step "Testing that MorphMarket answers from this Mac (reads one listing, writes nothing)"
if ! .venv/bin/python scrape_listings_api.py --dry-run-page-one; then
  echo
  echo "MorphMarket did not answer normally from this Mac. The schedule was not installed." >&2
  echo "If you are on a VPN, turn it off and run this script again." >&2
  exit 1
fi

step "Scheduling the daily scrape at 8:35am"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$REPO/scripts/local/run_scraper.sh</string>
    <string>catalog</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>8</integer>
    <key>Minute</key>
    <integer>35</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLISTEOF
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"

launchctl bootout "$DOMAIN/$LABEL_NEWEST" 2>/dev/null || true
if [ "$DAILY_ONLY" = "1" ]; then
  rm -f "$PLIST_NEWEST"
  echo "Skipped the 30-minute newest check (--daily-only)."
else
  step "Scheduling the newest check every 30 minutes"
  cat > "$PLIST_NEWEST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL_NEWEST</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$REPO/scripts/local/run_scraper.sh</string>
    <string>newest</string>
  </array>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_NEWEST</string>
  <key>StandardErrorPath</key>
  <string>$LOG_NEWEST</string>
</dict>
</plist>
PLISTEOF
  launchctl bootstrap "$DOMAIN" "$PLIST_NEWEST"
fi

echo
echo "Done. The full scrape runs every day at 8:35am and logs to:"
echo "  $LOG"
if [ "$DAILY_ONLY" != "1" ]; then
  echo "The newest check runs every 30 minutes while the Mac is awake and logs to:"
  echo "  $LOG_NEWEST"
fi
echo "Run one right now with:"
echo "  $REPO/scripts/local/run_scraper.sh"
echo "Check results on the website's Data status page (/status)."
