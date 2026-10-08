# Keeping the market data fresh

## What went wrong

The daily scrape runs on GitHub's servers. Since August 31, 2026, MorphMarket
has refused every request coming from those servers (HTTP 403, "Forbidden").
Websites often block big data-center networks like GitHub's. They rarely block
a normal home internet connection, which is why the two scrapes started from
elsewhere on August 28 and 29 worked.

So the fix is to send the scrape from somewhere MorphMarket accepts. There are
two ways. Pick one.

## Option A (free, recommended): run it on your Mac

Your Mac uses your home internet, which MorphMarket does not block. A one-time
setup schedules the scrape every morning at 8:35. If the Mac is asleep then, it
runs as soon as the Mac wakes up.

1. Open Terminal (press Command + Space, type Terminal, press Return).
2. Get the latest code. If you already have the repo on your Mac:

   ```
   cd ~/path/to/geck-data
   git pull
   ```

   If not:

   ```
   git clone https://github.com/tennysonmilesperhour/geck-data.git ~/geck-data
   cd ~/geck-data
   ```

3. Run the setup:

   ```
   scripts/local/setup_mac.sh
   ```

   It installs what the scraper needs (a few minutes the first time), then asks
   for your Supabase **service_role key** once. Find it in the Supabase dashboard
   under Project Settings, then API. The key is saved only in `.env.local` on your
   Mac and is never uploaded to GitHub.

   It then reads one listing from MorphMarket to prove the connection works, and
   only installs the daily schedule if that test passes.

4. To run a scrape right away instead of waiting for tomorrow:

   ```
   scripts/local/run_scraper.sh
   ```

   The first full run reads every crested gecko listing and takes one to three
   hours. After that, a listing whose price has not changed is skipped unless
   its details are more than six days old, so most daily runs are much
   shorter. The Mac stays awake while it runs.

**The past year of history:** each daily run also reads about 4,000 old
MorphMarket listing numbers (roughly 30 extra minutes) to fill in the Trends
page's "The past year" section, newest months first. The year is done after
about a week, and from then on this step takes seconds. To check that
MorphMarket still serves old listings before waiting a week:

```
cd scripts && ../scripts/.venv/bin/python backfill_history.py --probe
```

It reads 12 old listings, writes nothing, and says whether the backfill will
work. To fill the whole year in one sitting instead (a few hours):
`../scripts/.venv/bin/python backfill_history.py --all`. To turn the daily
step off, add `BACKFILL_DAILY_IDS=0` to `.env.local`.

**The newest check:** the setup also schedules a quick check every 30 minutes
that reads only MorphMarket's newest listings. It takes a minute or less, and
it is what makes a new crested gecko listing show up on the Geck Inspect
Market page (the Live tab) and in members' watchlist alerts within the hour
instead of the next morning. It pauses while the Mac sleeps and runs again
when it wakes. Its log is `~/Library/Logs/geck-scraper-newest.log`, and it
shows as "Newest listings check" on the Data status page. To keep only the
morning scrape: `scripts/local/setup_mac.sh --daily-only`.

**Checking it worked:** open the website's Data status page. "Rechecked
recently" should jump from 8% toward 100% after the first full run. The log on
your Mac is at `~/Library/Logs/geck-scraper.log`.

**Stopping it:** `scripts/local/setup_mac.sh --uninstall`

**Things that can break it:** a VPN on the Mac (it makes you look like a data
center again), the Mac being off for days (it catches up on wake), or a Supabase
key change (rerun the setup and paste the new key after deleting the old line
from `.env.local`).

Optional: add `DISCORD_OPS_WEBHOOK=...` to `.env.local` to get a Discord message
when a run fails.

## Option B (paid, no Mac needed): a residential proxy

A residential proxy is a service that forwards requests through ordinary home
internet connections. The scraper already supports one; it only needs the
address.

1. Sign up for a residential or mobile proxy provider. Several work; expect
   roughly $5 to $15 a month for this volume. Decodo's scraping API is not
   supported; it has to be a plain proxy address. Configure the provider for
   United States exits or use its username template features to request US
   exits. MorphMarket can return a small regional catalog from non-US exits.
2. Copy the proxy URL. It looks like `http://username:password@host:port`.
3. In GitHub, open the geck-data repository, then Settings, then Secrets and
   variables, then Actions, then New repository secret. Name it
   `MORPHMARKET_PROXY_URL` and paste the URL.

The catalog checks the proxy exit country before it starts. Add these optional
repository secrets when your provider needs settings beyond the proxy URL:

- `MORPHMARKET_PROXY_COUNTRY`: provider country code, default `us`.
- `MORPHMARKET_PROXY_SESSION_ID`: starting sticky-session identifier. One
  session is reused for the full catalog walk.
- `MORPHMARKET_PROXY_USERNAME_TEMPLATE`: provider-specific username format.
  It can use `{username}` for the username from the proxy URL, `{country}` for
  `MORPHMARKET_PROXY_COUNTRY`, and `{session}` for the current session id. Write
  the template in the syntax required by your provider. For example, place
  `{country}` and `{session}` wherever that provider expects its country and
  session values. The scraper does not assume a vendor's format. Include
  `{session}` so a bad exit can be rotated; existing URL query parameters and
  credentials are retained.

If a geo check does not report the requested country, the scraper changes the
session and retries up to five times by default. Catalog page 1 must contain at
least 50 items and report a next page. Suspicious pages are retried with a new
session, including early pages that appear truncated. `MORPHMARKET_PROXY_GEO_ATTEMPTS`
and `MORPHMARKET_PAGE_RETRIES` are optional GitHub Actions variables for changing
the default retry counts. The latter defaults to 2 retries per suspicious page.
Failure alerts include the GitHub run id, last detected country, pages walked,
and the reason. They are sent only when `DISCORD_OPS_WEBHOOK` is configured.

The weekday GitHub job and the twice-a-day newest check turn themselves back on
as soon as that secret exists. Until then they skip with a notice instead of
failing. The newest check reads up to 40 list pages twice a day, stopping at
the first page with no new crested listing.

For temporary connection failures, HTTP 429, or server errors (5xx), the catalog
retries the same list page after waits of 15, 30, 60, and 120 seconds. Detail
requests retry after 5 and 15 seconds. Other modes, including the newest check,
retry once after 10 seconds to keep waits short within its 15-minute job limit.
Each retry restarts the browser on the same route. Removed listings (404) and
access-denied errors (403 after the direct-to-proxy fallback) are not retried.

A catalog that ends naturally before `MIN_CATALOG_PAGES` (default 100, capped
at `MAX_PAGES`) now fails and asks you to check the US proxy location. Rows
already saved stay, but it does not mark unseen listings inactive.

If you do both A and B, the two schedules both refresh the same data. That is
harmless, but you only need one.

## Why not a GitHub runner on the Mac?

GitHub can also run its jobs on your Mac ("self-hosted runner"). This repository
is public, and GitHub warns that on public repositories a stranger's pull
request can end up running code on that machine. The Mac schedule above avoids
that risk entirely.

## Recovery checks and late GitHub schedules

See [the October 4 recovery notes](SCRAPER_RECOVERY.md) for measured scheduling
delays and the replacement Details and Sellers browser route. Both weekly jobs
remain paused pending capped live checks; their manual runs default to five
records. The new route uses `MORPHMARKET_PROXY_URL`, not `DECODO_AUTH`.
