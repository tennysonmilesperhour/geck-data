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
   supported; it has to be a plain proxy address.
2. Copy the proxy URL. It looks like `http://username:password@host:port`.
3. In GitHub, open the geck-data repository, then Settings, then Secrets and
   variables, then Actions, then New repository secret. Name it
   `MORPHMARKET_PROXY_URL` and paste the URL.

The weekday GitHub job turns itself back on as soon as that secret exists.
Until then it skips each morning with a notice instead of failing.

If you do both A and B, the two schedules both refresh the same data. That is
harmless, but you only need one.

## Why not a GitHub runner on the Mac?

GitHub can also run its jobs on your Mac ("self-hosted runner"). This repository
is public, and GitHub warns that on public repositories a stranger's pull
request can end up running code on that machine. The Mac schedule above avoids
that risk entirely.
