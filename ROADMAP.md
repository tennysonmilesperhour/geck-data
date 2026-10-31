# Geck Data: Roadmap

Rewritten 31 October 2026 from the git log, `DECISIONS.md`,
`docs/SCRAPER_SETUP.md`, `docs/SCRAPER_RECOVERY.md`, the GitHub Actions run
history and the `geck_data.scrape_runs` table. It replaces the July 2026
roadmap, whose phases are summarized under "What became of the July plan".
The July audit itself is kept in git history (commit 42355d9) and in
`STATE_OF_GECK_INTELLECT.md`.

Geck Data is the market-data side of Geck Inspect: a Next.js site at
geck-data.vercel.app plus the scrapers that fill the `geck_data` schema in
the Geck Inspect Supabase project. It stays crested-gecko-first: read paths
show crested data only.

Decisions that belong to Tennyson are listed as open questions at the end.
Nothing in this file decides them.

---

## 1. What exists now

### The site

- **Six pages in the header**: Price check (home), Morphs, Listings,
  Breeders, Trends, Markets. The September cut to four pages (26 Sep) was
  followed by Trends (week-by-week market movement and morph comparison)
  and Markets (US, South Korea, Japan, Europe, Canada) on 27 and 28 Sep.
- **Price check** is a value report: pick morphs as chips, see the typical
  sale range, sold and asking bands on one axis, a confidence line, then
  matching listings and recent sales. Every listing and breeder is priced
  against similar geckos (27 Sep).
- **Members only (13 Oct)**: single listings, photos and seller pages need a
  sign-in. Aggregates (prices, charts, value tables) stay public. The bulk
  data endpoints (`/data/market.json`, snapshot CSV, arbitrage) answer 401
  without a session or token.
- **Footer pages**: Methodology, Data status (`/status`), API docs,
  Privacy and Terms (8 Oct).
- **Baseline hardening (8 Oct)**: security headers, Dependabot (weekly
  grouped npm, pip and Actions updates), edge caching and SEO tags on
  public pages, PostHog analytics with exception capture, optional Google
  Analytics on public pages.
- **Retired routes redirect** to the pages above (/market, /indices,
  /compare, /sold, /trait, /combo and others; see `DECISIONS.md`, 26 Sep).

### The data pipeline (GitHub Actions)

| Job | Schedule | State on 31 Oct |
| --- | --- | --- |
| Newest listings check | 01:07 and 13:07 UTC daily | Working. Green on every run since the 27 Oct runner pin. |
| Cross-platform shops (Korea, Japan, Europe, US shops) | Weekdays 16:50 UTC | Working. 110 of 110 runs in 30 days succeeded. |
| Nightly index refresh | 08:30 UTC | Working. |
| Weekly images download | Mondays 11:00 UTC | Working. |
| Weekday catalog recrawl | Weekdays 14:35 UTC | Broken since 8 Oct, fix in progress (section 2). Last good walk 6 Oct. |
| Weekly 7-day API listings | Mondays 14:55 UTC | Failed 26 Oct on the Ubuntu 26.04 runner; pinned to 24.04 on 27 Oct. Next run 2 Nov. |
| Weekly adjustment factors | Mondays 13:00 UTC | 401 since 19 Oct; needs one secret (section 2). |
| Weekly Details and Sellers | Paused on purpose | Rebuilt on the browser and proxy route; waiting for capped manual checks (`docs/SCRAPER_RECOVERY.md`). |
| Anthropic billing pull | Paused (schedule commented out) | Not running. |

Other pipeline facts worth knowing:

- MorphMarket blocks GitHub runners directly, so MorphMarket jobs go
  through the residential proxy in the `MORPHMARKET_PROXY_URL` secret.
  Decodo is gone.
- A Mac scheduler (`scripts/local/`, `docs/SCRAPER_SETUP.md` Option A)
  exists as the free alternative. No Mac-triggered runs appear in
  `scrape_runs` in the last 30 days.
- Scheduled GitHub runs often start four to six hours late; this is
  GitHub's event delivery, documented in `docs/SCRAPER_RECOVERY.md`.
- Discord failure alerts are wired in every workflow but the
  `DISCORD_OPS_WEBHOOK` secret is not set, by Tennyson's choice.
- A year of history was filled from sampled MorphMarket listing ids
  (`scripts/backfill_history.py`, 27 Sep).
- Schema changes belong in the geck-inspect repo. `supabase/migrations/`
  here is an archive of the retired standalone database.

### Companion pieces

- **Geck Inspect** reads this data through `/data/market.json` and direct
  queries.
- **Eye in the Sky** (Chrome extension) posts to `/api/ingest`. It was
  silent from May; whether to revive or retire it is still open.

---

## 2. Open work, in order

### Now: get every scheduled job green

1. **Catalog recrawl.** Every run from 8 Oct to 30 Oct failed in its first
   seconds: the proxy refused the tunnel to the IP geolocation service,
   and with no `{session}` template the preflight crashed while trying to
   rotate. On 31 Oct the geo check gained two fallback services and
   continues with the exit marked unknown when none answers; full catalog
   pages without a `next` key are accepted (the API leaves it out); a
   failed request no longer poisons the next one. The page-1 and
   100-page minimum guards still stop a regional catalog from marking
   listings inactive. Confirm the next scheduled runs complete a full walk.
2. **Adjustment factors 401.** The GitHub copy of `SUPABASE_SERVICE_KEY`
   no longer matches the Vercel copy. The endpoint now also accepts
   `CRON_API_TOKEN`; it needs one random value saved in both GitHub
   Actions secrets and Vercel production env (then a redeploy).
3. **Weekly 7-day API job.** Check the 2 Nov run on the pinned runner.
4. **Schedules after the DST change.** Catalog and cross-platform crons are
   written for Mountain Daylight Time; on Mountain Standard Time they run
   an hour earlier in local time. Revisit if the local clock matters.

### Next: finish the scraper recovery

5. **Details and Sellers.** Run each manually with `max_records` 5, inspect
   the saved fields, then clear the backlog and restore the weekly
   schedules (`docs/SCRAPER_RECOVERY.md`). Sellers is the larger freshness
   gap. Waits on question 1.
6. **Pipeline freshness on `/status`.** Show hours since the last good run
   per job so a red catalog is visible without opening GitHub.

### Then: dependencies

7. **Dependabot majors.** Next.js 16, TypeScript 7, Tailwind 4 and
   react-dropzone 20 are open PRs. Each says on the PR what it needs.
   Tailwind 4 is a config migration; Next 16 and TypeScript 7 need build
   checks before merging. The grouped minor update needs a one-line type
   fix and a sign-in check because it moves `@supabase/ssr` from 0.5 to
   0.12.

### Later: product work that builds on fresh data

These carry over from the July plan and are not started:

8. **Alerts that reach people.** Watchlist exists; delivery by email or
   Discord and a daily digest do not. Waits on question 5.
9. **Real sold prices.** Sold prices are the last asking price before a
   listing came down. Auction closes (extension), "last ask before
   delisting" as a labeled tier, and seller-reported sales would each add
   a separate, labeled price kind.
10. **Seller toolkit.** A breeder claims their MorphMarket store and sees
    their listings against the market, days on market and reprice hints.
11. **Pairing value planner.** Pick two parents' traits, see the market
    value of the likely offspring combos. The breeding tables exist with
    no UI; the genetics calculator lives in Geck Inspect, so this should
    link to it rather than duplicate it.
12. **Pricing engine v2.** A regression on trait, age, sex, proven status
    and region, refreshed weekly into `price_adjustment_factors`, once sold
    volume supports it.
13. **Monthly public market report** as the shareable, SEO-facing piece.

---

## 3. What became of the July plan

| July phase | Outcome |
| --- | --- |
| R: Resuscitate the pipeline | Done, then redone: Decodo removed (Aug), MorphMarket JSON API ingest added, Playwright and a residential proxy replaced it after MorphMarket blocked GitHub runners (Sep), honest freshness labels shipped. |
| T: Truth in every number | Largely done in the 29 Aug audit pass (`sharedaudit.md`): fabricated numbers removed, sold pools labeled, coverage gates, one price observation per instant. |
| U: UX consolidation | Done differently: the site was cut to four pages on 26 Sep, then grew to six with Trends and Markets. |
| V: Visualization overhaul | Done through several restyles, ending in the Linear-style light and dark theme (28 Sep). |
| A: Alerts and retention | Not started beyond the watchlist (item 8). |
| G: Grow the moat | Partly: Markets and cross-platform sources shipped (Korea, Japan, Europe). The rest is items 9 to 13. |

---

## 4. Open questions for Tennyson

None of these are decided here.

1. **Proxy country.** Does the residential proxy exit in the United States?
   If it can, should a `{session}` username template be added so the
   scraper can rotate a bad exit? The Details and Sellers recovery waits on
   this.
2. **Mac or proxy.** Keep the residential proxy as the main route, return
   to the Mac scheduler, or run both?
3. **Discord alerts.** Failure alerts stay off by your choice. Keep it that
   way, or add the webhook now that the pipeline has had a silent month?
4. **Eye in the Sky.** Revive the extension, or retire the streams that
   depend on it (sold events, auctions, views)?
5. **Alert delivery.** Email (adds Resend), Discord, or both, and may Geck
   Inspect members receive it?
6. **Paid tiers.** Read entitlements from Geck Inspect, or keep Geck Data
   free (with the members-only gate) until alerts prove retention?
7. **Anthropic billing pull.** Turn the paused daily job back on, or remove
   it?
8. **Schedules after DST.** Keep the UTC times, or move them so the local
   start time stays the same?

---

## 5. Milestone

The milestone from July still stands: **30 consecutive days of
uninterrupted data flow, and 10 real breeders or sellers who each ran a
price check and set a watch.** The 30-day clock restarts once the catalog
recrawl completes on schedule.
