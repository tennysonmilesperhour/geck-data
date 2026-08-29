# Geck Intellect presentation and timeline audit

Written 2026-08-29 against production (`geck-data.vercel.app`,
Supabase project `dhotmtgryuovkmsncdby`, `tennysonmilesperhour/geck-data`
on `main`). Numbers below were queried live today, not copied from older
docs.

Companion reading: `STATE_OF_GECK_INTELLECT.md` (2026-07-16) and
`ROADMAP.md`. This file is a now-cast of how the site reads to a visitor
today, after the MorphMarket JSON API ingest (scrape runs 694 and 695)
and the June 2026 Decodo outage.

---

## Verdict for someone looking at it now

The site is still built as "what's happening right now," and that is
the wrong sentence for the dataset it has.

A visitor on 2026-08-29 sees a live-looking crested gecko market:
green status dot, "refreshed from MorphMarket every day," combo
medians, deal cards "seen 2h ago," 90-day trend windows, twelve
monthly reports. Underneath:

- **10,158 listings are marked `live`. Only 565 were last seen in the
  past 48 hours.** The other 9,274 have not been re-observed since
  mid-June. They are still counted as live, still in medians, still in
  combo rollups, still in "what's hot."
- **Price history has a 78-day hole (2026-06-10 to 2026-08-26)** plus
  a 15-day hole (2026-04-23 to 2026-05-07). 95 calendar days have
  zero ticks. Ticks run 2026-04-22 through 2026-06-09, then nothing
  until 2026-08-24 (API ingest). `/trends` fills empty weeks with
  zeros, so the outage reads as a market that stopped listing and
  stopped selling.
- **Sold history stops on 2026-06-07.** `listings.sold_at` has 2,849
  rows (the real comps pool), all dated 2026-05-17 to 2026-06-07.
  509 of those still have `is_active=true`. The homepage instead
  prints `current_status='sold'` (81). `listing_status_events` has
  92 sold rows. Demand charts are not a missing table. They are a
  freeze, plus a second sold definition that almost nobody is in.
- **The stale-data banner will not fire.** It keys off
  `max(market_listings.last_seen_at)`. That timestamp is today because
  of the 565 new API rows, so the 9k June zombies keep the rest of the
  page looking current.
- **Every `market_listings.species` value is still `unknown`**
  (10,239 / 10,239). The UI talks as if the catalog is crested-only.
  The filter is a comment, not a column.

Useful pieces that do exist: `/whats-it-worth` as a valuation
skeleton, `/methodology` and `/status` as trust surfaces, 2,849
May-June sold comps (frozen), 1,154 listings with real
`cached_traits` (512 from this week's ingest), and the new API path
that can keep the next 7 days honest if weekly ingest keeps running.
`first_listed_at` exists (oldest 2023-02-25) but is filled on only
**1,670 / 10,239 rows**. The other 8,569 have no MorphMarket listing
date, so any timeline that "falls back" to `first_seen_at` is mostly
a scrape calendar.

**Bottom line:** a buyer or breeder using this today to time a
purchase, judge a deal, or read a 90-day trend is looking at a
May-June snapshot with a 7-day API patch glued on the end, labeled as
live. That is not genuinely useful historical integration. It is a
presentation layer that outran the feed.

---

## What changed since the July 16 audit

| Measure | 2026-07-16 | 2026-08-29 |
|---|---|---|
| `market_listings` | 9,674 | 10,239 |
| `species='unknown'` | 100% | 100% (10,239) |
| Date coverage of scrape ticks | 2026-05-09 to 2026-06-09, then dead | same, plus 2026-08-22 to 2026-08-29 API window |
| `price_history` ticks | 44,938, frozen since 06-09 | 45,632; 694 new ticks in week of 08-24 |
| Sold events (`listing_status_events`) | 92 | 92 |
| `listings.sold_at` | 2,849 (through 06-07) | 2,849, still frozen 06-07 |
| `first_listed_at` populated | not called out | 1,670 / 10,239 (16%) |
| Currency | 9,152 USD / 202 CAD | listings: 9,591 USD / 205 CAD / 104 EUR / 19 GBP |
| `cached_traits` populated | thin (norm_traits was 642) | 1,154 (512 from this week) |
| Decodo listings scrape | 429, hourly paused | still dead; hourly + weekly-resync workflows removed 2026-08-29 |
| New feed | none | MorphMarket JSON API, scrape_runs 694 (84) and 695 (556) |

The July diagnosis still holds: the blocker is data, not missing
charts. The API ingest fixed *forward* coverage for one week. It did
not resurrect June-August, did not flip stale `live` rows to inactive,
and did not refill sold events. The UI still assumes a continuous
hourly catalog.

---

## How the homepage presents information

Live URL: `https://geck-data.vercel.app` (spec name
`geckintellect.geckinspect.com`).

### Hero

`src/app/page.tsx` plus `HeroBand` and `getMarketSnapshot()`.

- Headline: "What's happening right now."
- Subcopy: "refreshed from MorphMarket every day."
- Green "Live" status dot is decorative. It is not wired to scrape
  health.
- KPIs: median listing, live count, active sellers, hottest combo.
  Median/count/sellers animate via client `CountUp`. Without JS (and
  on first paint, and for crawlers) those tiles render as `$0` / `0`.
  Hottest combo and the "81 sold all-time" subtitle are server text,
  so a no-JS fetch shows a live combo with 36 listings next to a
  median of $0. That is a presentation bug even if hydration later
  fills the numbers.
- Live count is `current_status='live'` with **no freshness filter**.
  Production: 10,158 live, of which 565 seen in 48h. The number a
  visitor is meant to trust is about 18x too large.
- Median is the median of up to 10,000 live `price_usd_equivalent`
  values, also unfiltered by `last_seen_at`. Queried today: live
  median **$280** on 9,930 priced live rows. That median is dominated
  by June-stale asks, not by what is actually for sale this week.
  This week's 529 individual USD ads averaged **$351.84** (median
  $254.86) in the API ingest. Mixing those two populations without
  labeling them is the core honesty problem.

### What's hot / opportunities / sellers

- Combo tiles come from `v_combo_rollups` with `window_days: 365`.
  They can look deep. Sold counts on the homepage fetch were tiny
  (0-3 sold all-time on the top combos). Confidence chips already
  say "Low" / "Very low." That part is honest. The live counts are
  not, because they include stale live rows.
- Homepage copy for opportunities claims listings "seen 2h ago."
  That gate is real: `last_seen_at` within 7 days
  (`OPPORTUNITY_FRESHNESS_DAYS = 7`). So the deal strip is the one
  panel that *is* restricted to this week's ingest. Then it matches
  traits with `traits.includes(token)` against combo names split on
  `×` / `x`. That over-matches (a "Tri-color Lilly White" listing
  was paired with "Lilly White × Soft Scale" in the live fetch)
  and treats group lots as single-animal discounts ("Wholesale 5/10
  Lot Cresties" at $50 vs a $500 combo median, -90%). A visitor
  reading "opportunity" is being shown lots, het-only animals, and
  token collisions, not comps.
- Top sellers still rank on `market_sellers.total_listings`. Those
  totals were mostly built in May-June. Pangea at 269 listings is a
  historical stock number, not "active this week."

### Scrollytelling

Ridge plots, geography, cadence heatmap, days-to-sell are
client-charted ("Loading chart..." without JS). Geography copy
claims US/EU floors and Australia/Japan premiums. The catalog is
still ~97% USD. That paragraph is not supported by the data.
Cadence "when breeders choose to list" will light up scrape days
and the Aug 29 ingest spike, not breeder behavior, because several
surfaces still bucket on `first_seen_at`.

---

## Timelines: how historical data is actually used

This is the part that matters for "useful over time."

### `/trends` (the longitudinal page)

File: `src/app/trends/page.tsx`.

Intent in comments is good: 90-day default, 180-day toggle; compare
late half to early half; use `first_listed_at` falling back to
`first_seen_at`; annotate backfill weeks; fill empty buckets with
zeros so gaps are visible.

What that does **today**:

1. **90-day window (2026-05-31 to 2026-08-29)** covers three
   different regimes mashed into one chart:
   - early: leftover May-June Decodo walk
   - middle: eleven weeks of *no observations* (zeros)
   - late: one API dump of 556 first-listed-in-7-days animals,
     almost all timestamped into the last few days of the window
2. **`fillBuckets(..., 0)` turns the outage into a crash.** Empty
   weeks are drawn as zero added and zero sold. The page annotates
   backfill spikes (`>= 3x median` and `>= 50`) as "Backfill week."
   It does **not** annotate a multi-week zero run as "feed down."
   A visitor reads: listings stopped, sales stopped, inventory
   delta went sideways, then a spike. That is the scraper, not the
   crested market.
3. **"vs early 45d" deltas are not a market move.** Late 45 days
   (roughly Jul 15-Aug 29) have almost no scrape and then the API
   week. Early 45 days still contain June volume. Added/sold/price
   deltas will look like a collapse followed by a bounce. They are
   an ingest calendar.
4. **Sold series cannot carry demand after June 7.** The warehouse
   has 2,849 `sold_at` timestamps, all inside 2026-05-17 to
   2026-06-07. `/trends` charts `listing_status_events` (92 rows),
   not that pool. The API ingest does not write sold transitions;
   `mark_unseen_listings_inactive` was correctly *not* called on
   the windowed walk. Weekly sold on the chart is near zero after
   the gap. Supply/demand is then "added / max(sold, 1)" and
   explodes whenever a scrape lands.
5. **Weekly median price** uses `price_history.observed_at`.
   Per-week ticks:

   | Week (UTC) | ticks | distinct listings |
   |---|---|---|
   | 2026-04-20 | 1 | 1 |
   | 2026-05-04 | 400 | 400 |
   | 2026-05-11 | 14,623 | 7,111 |
   | 2026-05-18 | 9,767 | 6,614 |
   | 2026-05-25 | 9,738 | 6,834 |
   | 2026-06-01 | 9,737 | 6,909 |
   | 2026-06-08 | 672 | 131 |
   | then nothing |
   | 2026-08-24 | 694 | 565 |

   A continuous median line across May-August is not a price index.
   It is "we sampled heavily in May, once in early June, then once
   in late August."
6. **Maturity bar chart is not windowed.** Comment in the page:
   "Not window-scoped, reflects the current live catalog." That
   catalog is 91% stale live. Maturity medians are June asks.
7. **`limit(30000)`** on listings, sold events, and price ticks.
   Fine at today's size. Not a current bug.
8. **Market-date coverage chip** is the most honest widget on the
   page. It says what fraction of in-window rows have
   `first_listed_at`. Keep it. It should also say how many weeks
   in the window have zero observations.

### Homepage combo sparklines (14-day)

`getComboDailyAppearances()` buckets **`first_seen_at`**, not
`first_listed_at`, over the last 14 days. The homepage comment
calls this "actual day-by-day discovery, not synthetic deltas."
Discovery here means "when our ingest wrote the row."

This week's 565 API rows were written on 2026-08-28/29. Their
MorphMarket `first_listed` values are spread across 2026-08-22
through 2026-08-29. The sparkline will show a one- or two-day
spike, not seven days of listings. That is the opposite of
useful history for someone looking now.

### `/reports` and `/reports/[month]`

- Index lists the last 12 calendar months from **today's date**,
  labeled "current" vs "snapshot." There is still no
  `market_report_snapshots` table. Subtitle: "generated against
  today's data." Footer: scheduled versioned records are "on the
  roadmap."
- Month pages **do** filter `first_seen_at` and sold events to
  that calendar month. So January-April 2026 reports will show
  ~0 added (production `first_seen_at` starts 2026-05-09). July
  2026 will show ~0. August 2026 will show the API ingest plus
  whatever `first_seen_at` landed in August (almost only the
  ingest). The index still invites the visitor to click
  "September 2025" as if a report exists.
- Gainers/losers use `combo_index_daily` month vs prior month.
  If that table was not refreshed through the outage, mover %
  is noise or empty. The "In plain English" paragraph will still
  speak in market language ("supply outran demand") from added
  vs 92 sold events.

Calling these "monthly market reports" is the least honest
timeline on the site. The July audit already said they synthesize
months. That is still true of the *menu*. Individual months are
now date-filtered, which makes empty months look like a dead
market rather than "we have no snapshot."

### `/indices` and `/market`

These remain parallel trend surfaces (July audit: collapse to
one). I did not re-derive every chart here. Anything using
`price_history` or `first_seen_at` over a rolling 7/30/90d
window has the same hole: May-June mass, summer zero, August
spike. 7d / 30d deltas as of today are almost entirely "API
ingest vs nothing."

### Listing detail timelines

Per-listing `price_history` depth: 9,920 listings have at least
one tick; median 5 ticks; 1,071 have exactly one. Those ticks
cluster in a ~5 week window (May 9-June 9) plus one August
point for the 565 new rows. A per-listing sparkline cannot show
a true hold/sold path over time for almost any animal. It can
show "we pinged this ask several times in May."

The API ingest does write `price_history` (694 ticks this week)
but only as a first observation, not a series, because we have
not been walking those listings daily.

---

## Freshness presentation vs freshness reality

| Mechanism | What it does | What a visitor concludes | What is true |
|---|---|---|---|
| Hero "Live" dot + "every day" | Always on | Feed is healthy | Daily Decodo is dead; API weekly is new |
| `StaleDataBanner` (48h) | `max(last_seen_at)` | No banner today | 91% of live rows are 10+ weeks stale |
| Opportunity "seen 2h ago" | `last_seen_at` < 7d | These ads are live | True for this strip only |
| `DataFreshness` on /trends | newest tick in the pulled window | "data as of [today]" | Newest tick is today; the window is mostly empty |
| Market-date coverage chip | % with `first_listed_at` | Calendar quality | Useful; does not mention the gap |
| `/status` | ingest health | Operator view | Right place; not the front door |

**Recommended freshness rule (not implemented):** treat a listing
as live for public KPIs only if `last_seen_at` is within N hours
of the latest successful listings scrape (or a fixed 48-72h).
Keep the June rows in the warehouse. Stop putting them in "right
now."

The banner should key off **coverage** (share of previously live
rows re-seen this run), not `max(last_seen_at)`. One fresh batch
must not clear a site-wide stale warning.

---

## Trait, combo, and species presentation

- `cached_traits` / `norm_traits`: 1,154 / 10,239 (11%). This
  week's ingest: 512 / 565 (91%). The live catalog's trait
  economics are still mostly the old pipe-delimited HTML scrape
  plus a week of real MorphMarket tags. Combo matching that
  `includes()` tokens will keep promoting pseudo-traits and
  collisions until vocabulary cleanup (July audit, still open)
  lands.
- Species: 100% `unknown`. Crested is assumed in copy and in
  the API ingest filter, not stored.
- Combo names on the hero (Lilly White × Axanthic, etc.) are
  the right product objects. Confidence "Low / Very low" is
  correct given sold n. Do not let live_count from stale rows
  make a low-confidence combo look like a thick market.

---

## Currency and region

`listings` currency today: 9,591 USD, 205 CAD, 104 EUR, 19 GBP.
EUR/GBP arrived with the API ingest (EU/UK MorphMarket ads).
That is new since July, when the audit found no GBP/EUR at all.

It is still not enough for regional timelines or arbitrage UI.
Geography scrolly copy should not talk about Australia/Japan
premiums. `/region/[code]` remains a blank-location problem for
the old rows (`seller_location` was ~90% blank in July). New
API rows do carry country on some sellers. Mixing them in a
choropleth without saying "n= this week only" will look like a
world market.

---

## Pipeline truth (for `/status` and for this audit)

Latest `scrape_runs`:

- 695 listings **success** 2026-08-29, triggered_by
  `geck-check-morphmarket-api-weekly`, 594 attempted / 556
  succeeded. This is the 7-day API ingest.
- 694 listings **success** 2026-08-28, `geck-check-morphmarket-api`,
  84/84 (24h snapshot).
- 693 sellers **failed** 2026-08-24 (Decodo).
- 691 details **failed** 2026-08-24 (Decodo).
- 690 listings weekly-resync **failed** 2026-08-23 (Decodo).
- Images jobs "succeed" with 0 attempted / 0 succeeded (no work).

GitHub Actions: Decodo hourly and weekly-resync workflow files
were removed 2026-08-29. Weekly API workflow
`.github/workflows/scrape-listings-weekly-api.yml` is on `main`
(Mondays 8:55am Denver). Image downloader remains. Details and
sellers Decodo workflows are still in the repo with schedules
commented out.

`mark_unseen_listings_inactive` was not run on the API ingest
(correct for a windowed walk). Side effect: stale `live` flags
were not cleaned. Until a full catalog pass or an explicit
inactive sweep exists, public "live" counts stay wrong.

---

## Page-by-page, what a visitor can trust today

| Surface | Trust for "now" | Trust for history |
|---|---|---|
| Hero live count / median | Low (stale live rows) | n/a |
| Hero hottest combo live_count | Low | n/a |
| Opportunity strip | Medium (fresh last_seen), matching is sloppy | n/a |
| Top sellers | Low (stock from May-June) | Medium as a directory |
| `/trends` 90d / 180d charts | Low | Low until the gap is labeled or excluded |
| `/trends` market-date chip | High | High |
| `/reports` month menu | Low (12 months implied) | Low |
| `/reports/[month]` for May-Jun 2026 | Medium if labeled as scrape months | Medium |
| `/reports/[month]` for other months | Empty-as-dead-market | None |
| `/whats-it-worth` trait bands | Medium on high-volume traits, if comps are sold+traits | Thin sold pool (still ~1.6k class from July, not refreshed) |
| `/sold` | Thin | Thin |
| `/methodology` `/status` | High if they describe the outage | High |
| Listing price sparkline | Low as a time series | "we saw this ask N times in May" only |
| Scrolly geography / cadence | Low | Low |

---

## What would make the timelines genuinely useful

In priority order, for a visitor looking *now*:

1. **Split the catalog in the UI.** "Seen this week" vs "last
   confirmed June 2026." Do not mix them in one median or one
   live count. The warehouse can keep both.
2. **Change the stale rule** from `max(last_seen_at)` to a
   coverage ratio, and show a persistent banner while <80% (or
   similar) of previously live rows have been re-seen.
3. **Draw the June-August hole as an outage, not as zeros.**
   On `/trends`, either break the axis, grey the gap, or default
   the window to "continuous coverage only" (May 9-June 9 and
   Aug 22-29 as two series, not one).
4. **Bucket combo sparklines and reports on `first_listed_at`**,
   not `first_seen_at`, whenever it is present. The API rows
   already have it. Using ingest time collapses a week into a
   spike.
5. **Stop shipping twelve synthetic report months.** Only link
   months that have either a stored snapshot or a minimum number
   of `first_seen_at` / `price_history` days. Empty months should
   404 or say "no scrape coverage," not "0 listings added."
6. **Do not talk about daily refresh** until a daily (or 4-hour)
   listings walk is actually running. Weekly API is the truth.
   Say weekly.
7. **Sold feed.** Without sold transitions, every demand,
   days-to-sell, and supply/demand widget should be hidden or
   explicitly "insufficient sold observations." 92 events is not
   a market.
8. **CountUp should SSR the real number.** Crawlers and first
   paint currently advertise $0.
9. **Keep `/whats-it-worth` as the product**, but point comps at
   sold rows with traits and a recency window that *excludes* the
   outage or labels it. Do not let stale live asks pad the band.
10. **Species column.** Write `crested` (or `Correlophus ciliatus`)
    on API rows going forward so the UI is not lying with
    `unknown`.

The GitHub Action weekly ingest will keep adding a 7-day pulse
every Monday. If the UI does not learn to treat that as a pulse,
each Monday will look like a demand shock on every 7d/30d delta
on the site.

---

## Live site, 2026-08-29 (screenshots)

Base URL: `https://geck-data.vercel.app` (public, no Vercel auth).
`https://geckintellect.geckinspect.com` serves the same app.
`geckintellect.com` / `www.geckintellect.com` do not resolve.

Logged-out visitor sees the full market product. Only watchlist/alerts
ask for a login. Header pip is **READY** on every page. There is no
stale banner today. Screenshots:
`/workspace/geckintellect-audit/*.png` and `live-pages.json`.

What the visitor actually saw (not inferred from code):

**Pulse (`/`).** Settled live count **10,158** (matches SQL). Hero
CountUp paints `$0`, `$22`, `$32`, `$75` and live `0` / `3,021` /
`4,278` on the way to the final number, and those intermediates are
visible as if they were the answer. Server caption under median was
`$50 – $80 mid range` while SQL median of live priced rows is
**$280**. Hottest combo Lilly White × Axanthic. Opportunities include
Cappuccino × Super Dalmatian **$3,075 on n=2** used as the baseline
for a **-90.2%** "deal", and a **5/10 lot at $50 vs $500**. Four
homepage long-read charts stayed on "Loading chart…". CZ/GB/SK
sellers are shown with a bare `$`.

**`/trends`.** Market-date coverage pill **100%** (565 of 565
in-window). Updated 2h ago. Window 90 days. KPIs: added **565
(+100.0% vs early 45d)**, sold **0**, median **$250 (-100.0% vs
early 45d)** on 995 ticks. Production vs sales is a flat zero from
~May 31 to ~Aug 9, then a vertical cliff to ~150. No backfill
annotation on the chart, despite the caption. Weekly median price:
"not enough observations" (honest) next to a -100% headline (not).
Maturity: **unknown 918 / $300** vs Baby 21, Juvenile 21, Subadult
19, Adult 14. All 24 trait rows badged "new this period."

**`/market`.** Timeframe chip **12 months**. Red banner: **NO DATA
YET** / `v_market_index` returned 0 rows, immediately above
temperature **50 warm** and four index cards (Lilly White 889,
Harlequin 1,000, Axanthic 618, Cappuccino 1,400) with unlabeled
deltas. Top movers: the **same two combos** as both appreciators and
depreciators at ±0.0%. Peak Indicator says "Sell into strength" on
n as small as 2.

**`/indices`.** "80 of 671 known combos." Every visible 7d/30d/90d
delta is **+0.0%**. The advertised 90d spark column is **—** on
every row. `+0.0%` reads as a measured flat market, not "no
history."

**`/sold`.** **Updated 106d ago.** 92 sold all-time, 0 in 7 days,
median time-to-sell **0 d**, median $275. Histogram caption claims
92 bins; the chart is empty. Cumulative sales: May spike, then a
dead plateau at 92 for ~3.5 months. Every row "4mo ago", source
**SCRAPER**, copy still credits "the extension."

**`/whats-it-worth` (Lilly White, subadult).** Headline typical sold
**$300–$436**, midpoint **≈ $436** (the top of that band, not the
middle), range **$229–$764**, medium confidence n=13. Trait chip
says 236 listings (live count, not sold n). Comps dated
**2026-05-10 to 05-14**, labeled recent on 2026-08-29. `0d`
days-to-sell on 4 of 5 comps.

**`/reports`.** August 2026: 0 sold events. September 2025 is a
clickable month that reports **0 listings added**.

**`/price-drops`.** Updated **80d ago**, biggest drop **-100.0%**.

**Empty nav.** `/shows` and `/cross-platform` are 0/0 placeholders
in top-level nav. `/listings` (no id) is 404. Nav "Drops" goes to
`/price-drops`.

**`/methodology`.** Last reviewed **2026-05-22**. It tells the
visitor that chart copy which the methodology does not back is a
bug. By that rule, `/market`, `/indices`, and `/trends` headlines
are self-declared bugs. It also leaks RPC and file names
(`v_market_index`, `src/lib/market/sources.ts`).

**`/daily-log`** is the honest page: 7 of 9 event types "no
activity," last event 2h ago.

**`/combo/lw-axa`.** Caption "last 26 weeks" vs pill **3 weeks**.
Looks like a -42% collapse ($795 to $463) across a window the
ingest just created.

---

---

## Code honesty issues still on `main` (UI pass)

The warehouse problems above are enough to mislead. These are
*additional* presentation bugs that would still be wrong even if the
feed were continuous. Verified against current `main`, 2026-08-29.

`listings_history` (51,122 rows) is **not read by any page**. Timelines
are `price_history`, `listing_status_events`, `combo_index_daily`, and
arrival dates. Observation log and UI history are different objects.

| Surface | What it actually plots |
|---|---|
| `/trends` | Real weekly added/sold/price, zero-filled 90/180d. Maturity bars = live snapshot. |
| `/indices` | Real daily medians, last 90d (`combo_index_daily`). Tiles mix snapshot + 7/30/90d deltas. |
| `/market` | Weekly index RPCs. Combo sparks 60d daily. **Top-movers spark is two points.** Combo-detail chart returns `series: []`. |
| `/` Pulse | 14-day appearance sparks on `first_seen_at`. KPIs are a snapshot. |
| `/sold` | Activity chart is real 26-week counts. Table is **last 500** rows while the KPI says "all time." |
| `/listings/[id]` | Real `price_history` ticks; spark x-axis is index, not time. Comment says 180d, query is limit 500. |
| `/combo/[slug]` | Weekly spark from **current live** members' ticks, sold prices mixed in. |
| `/trait/[slug]` | Weekly sold counts. The "180d" KPI is **not** date-filtered. |
| `/whats-it-worth` | Snapshot 180d sold band. No timeline. `?combo=` still the 12 hardcoded ids. |
| `/reports` | 12-month menu from `new Date()`. Month pages recompute, they do not load a stored snapshot. |

Fabricated or biased numbers still in code:

1. **Movers math** compares `v_combo_rollups(w)` to `v_combo_rollups(2w)`.
   The short window sits inside the long one, so deltas shrink toward
   zero. Same pattern on peak indicators.
2. **`stddev = median * 0.15`** is invented dispersion, not observed.
3. **Breeder score fallback** `30 + (idx % 60)` is a function of sort
   order, not reputation.
4. Combo-detail **median ask / spread / days-to-sell hardcoded `0`**,
   and the detail chart is intentionally unwired.
5. Header **`Ready` is hardcoded**. The 48h `StaleDataBanner` can
   disagree with it. After today's ingest, both look fine while 91%
   of "live" rows are June-stale.
6. **Ask labeled as sold** in at least one sold/comp path; sold
   "all-time" count is `rows.length` of the 500 cap.
7. **Two combo dictionaries:** 12 `HIGH_VALUE_COMBOS` vs
   auto-discovered `"A x B"`. `/indices` uses discovery;
   `/whats-it-worth?combo=` and several labels still use the 12.
8. **Pipe vs comma traits.** `parseTraitList` splits on `|`;
   `trait-premium.ts` does not. Substring `ILIKE` / `includes()`
   elsewhere. Combined with 8,569 rows missing `first_listed_at`
   and 9,085 missing `cached_traits`, combo identity is unstable.
9. **`/methodology` last reviewed 2026-05-22.** It still describes
   a 12-combo market view and pHash arbitrage that the live pages
   do not run.
10. `/market` temperature links to `/trends?timeframe=12mo`. Trends
    only reads `?window=90|180`. Dead param.

Closest honest longitudinal UI: `/trends`, if the 78-day hole is
labeled. Closest daily series: `combo_index_daily` on `/indices`,
if that materialized view is actually refreshed (not re-checked
in SQL this pass).

---

## Numbers appendix (queried 2026-08-29)

```
market_listings                 10,239
  species unknown               10,239 (100%)
  current_status live           10,158
  current_status sold           81
  live last_seen within 48h     565
  live last_seen older than 48h 9,274
  last_seen before 2026-06-15   9,355
  first_listed last 7 days      565
  cached_traits non-empty       1,154
  of which last_seen >= 08-22   512 / 565

first_listed_at range           2023-02-25  -> 2026-08-29
first_seen_at range             2026-05-09  -> 2026-08-29
last_seen_at max                2026-08-29 15:04:38 UTC

price_history                   45,632 ticks
  min observed_at               2026-04-22
  max observed_at               2026-08-29
  listings with any tick        9,920
  exactly 1 tick                1,071
  2-5 ticks                     7,256
  6+ ticks                      1,593
  median ticks / listing        5
  gap                           2026-06-10 -> 2026-08-26 (78 days)

listings                        9,920 (7,507 is_active / 2,413 inactive)
  sold_at                       2,849 (2026-05-17 -> 2026-06-07; 509 still active)
  availability sold             0
  scientific_name Correlophus   6,715 (rest null)
listings_history                51,122
listing_status_events sold      92
market_listings first_listed_at 1,670 filled / 8,569 null
  source scraper / other        9,920 / 319 (manual rows have 0 price ticks)
market_galleries                556 (all captured 2026-08-29 with run 695)
listing_images                  1,856
price_history zero-tick days    95
  gaps >7d                      2026-04-23->05-07 (15d); 2026-06-10->08-26 (78d)

listings currency               USD 9,591 | CAD 205 | EUR 104 | GBP 19

scrape_run 695                  success, 556 listings, 1,788 images
scrape_run 694                  success, 84 listings
```

Live site inspected: `https://geck-data.vercel.app` (SSR + code
on `main`). Client-only charts were not fully painted in the
headless fetch; their data contracts were read from source.

---

## Method

- Production SQL via the Supabase connector (read-only).
- Current `main` sources: landing snapshot, HeroBand,
  StaleDataBanner, freshness helper, `/trends`, `/reports`,
  `/reports/[month]`, plus a pass over `/market`, `/indices`,
  `/sold`, `/whats-it-worth`, `/listings/[id]`, `/combo`, `/trait`,
  Header, methodology.
- Compared to `STATE_OF_GECK_INTELLECT.md` (2026-07-16).
- Did not treat CountUp's pre-hydrate `$0` as a database fact.
- Did not call `mark_unseen_listings_inactive`.
