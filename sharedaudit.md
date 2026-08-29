# Geck Intellect presentation and timeline audit

Written 2026-08-29 and reconciled from multiple independent audit passes against
production (`geck-data.vercel.app`,
Supabase project `dhotmtgryuovkmsncdby`, `tennysonmilesperhour/geck-data`
on `main`). Numbers below were queried live today, not copied from older
docs. Production was changing during the audit: scrape run 695 and a later
combo-index refresh completed between observations. Where a value changed,
the later value and the cache discrepancy are called out explicitly.

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
May-June sold comps (frozen), 1,197 listings with real
`cached_traits` (555 from this week's ingest), and the new API path
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
| `cached_traits` populated | thin (norm_traits was 642) | 1,197 (555 from this week, after run 695 enrichment) |
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
7. **`limit(30000)` does not bypass the Supabase response cap.** The
   live page received about 1,000 rows: 995 valid price ticks and 993
   maturity rows, despite production holding 45,632 ticks and 10,239
   listings. Because neither query paginates or orders the source set,
   the 90-day price delta and the current-catalog maturity distribution
   are computed from an arbitrary truncated slice. This is a current,
   visitor-visible bug, not a future scale concern.
8. **The market-date coverage chip has the wrong denominator for the
   implied claim.** It showed 100% because all 565 rows returned by the
   in-window filter had `first_listed_at`; only 1,670 / 10,239 catalog
   rows (16.3%) have that field. Keep the chip, but label it “565 / 565
   arrivals in this selected window” and show catalog coverage plus
   observed-day coverage separately.

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
| Market-date coverage chip | % of already-selected in-window rows with `first_listed_at` | Looks like catalog calendar quality | 100% for 565 recent rows; only 16.3% catalog-wide, and it does not mention the gap |
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

- `cached_traits` / `norm_traits`: 1,197 / 10,239 (12%). This
  week's ingest: 555 / 565 (98%). The live catalog's trait
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
| `/trends` market-date chip | Medium if read as window-only | Low as catalog coverage |
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
Lilly White × Cappuccino at low confidence (43) with only three captured
sold comps; the same action panel still renders recommendations for rows
with total `n` as small as 2.

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

## Final reconciliation pass: additional critical findings

This pass was researched independently before reading the shared report,
then checked against Audit 1 above and the later Audit 2 contribution below.
It agrees with the central diagnosis, corrects one causal overreach in Audit
2, and adds the following issues. These are not stylistic preferences; each
one changes what a current visitor can reasonably infer from the page.

| Priority | Finding | Visitor impact |
|---|---|---|
| P0 | `/trends` queries are silently capped at about 1,000 rows | The displayed medians, maturity mix, and deltas are an arbitrary slice, not the requested population |
| P0 | Region, age, lineage, and source controls on `/market` do not filter the queries | The dashboard looks interactive while returning the same population under different labels |
| P0 | Market temperature returns neutral **50 / Warm** when its component data are absent | “No demand data” becomes a positive-looking market condition |
| P0 | Sold history has two unreconciled definitions | “92 sold all time” omits 2,849 inferred `listings.sold_at` records; neither pool is current enough for demand claims |
| P1 | Combo indices cover only five calendar dates | Lines and 7/30/90d deltas imply continuous history that does not exist |
| P1 | Index cutoff math turns stale data into `+0.0%` | “Unchanged” is displayed where the correct result is “unavailable / stale” |
| P1 | Repeated scrape ticks are treated as independent price observations | Frequently re-seen listings receive more weight than listings seen once |
| P1 | Auto-discovered trait pairs include parent/child synonyms | “Extreme Harlequin × Harlequin” and “Dalmatian × Super Dalmatian” are presented as economic combos |
| P1 | Header says `Ready` while `/status` says `Lagging`, `Down`, and `Stale` | The most visible status signal contradicts the diagnostic truth |
| P2 | Action language survives very-low confidence | “Sell into strength,” “arbitrage,” and “opportunity” invite decisions the evidence does not support |

### 1. The 1,000-row ceiling changes the answer

`src/app/trends/page.tsx` asks Supabase for 30,000 rows, but the live
response is capped by the project API limit. The rendered page exposed
the cap directly:

- 995 usable price ticks, although `price_history` contains 45,632 rows;
- 993 usable maturity rows, although `market_listings` contains 10,239;
- exactly 565 recent arrivals because that filtered result happens to
  fit below the cap.

There is no pagination and no deterministic source ordering on the price
or maturity queries. The page therefore cannot claim that its $250 median,
-100% delta, or maturity distribution describes the market. The fix is a
database-side aggregate/RPC for each chart, or paginated reads with explicit
ordering. Merely increasing `.limit()` is ineffective.

The same risk exists on other routes that request 1,500-30,000 rows from
PostgREST and then calculate in JavaScript. Every public metric should be
audited for **requested rows versus returned rows**, not just for a large
TypeScript limit.

### 2. `/market` filters are presentation-only

`src/lib/market/queries.ts` uses `filters.timeframe` to choose
`window_days`. It does not use `filters.region`, `filters.age`, or
`filters.lineage` in the market-index, rollup, mover, peak, regional, or
breeder queries. `filters.sources` changes the attribution label, not the
rows being analyzed.

That means a visitor can select `EU`, `adult`, a lineage, or a source and
still receive the same market result, potentially with a new source badge.
This is worse than a disabled control because the UI confirms a filter that
was never applied. Until every control changes the query and sample size,
remove or visibly disable it. Add contract tests that assert both the result
set and displayed `n` change for a known filter fixture.

### 3. “50 / Warm” is the empty-data default

`src/app/api/market/temperature/route.ts` zero-fills missing sold price,
sell-through, and days-to-sell values across the 52-week baseline.
`rescale()` returns `0.5` whenever `p90 <= p10`. With a flat or empty
baseline, all four normalized components become neutral and the weighted
composite becomes 50. The live page then says:

> Market temperature 50 · Warm · 0

That is not a measured temperature. It is the mathematical fallback for no
variation/no evidence. The API should return `score: null` unless minimum
coverage gates are met, and the card should say “Unavailable: sold stream
last observed 2026-05-14.” Never classify a fallback as Warm.

### 4. Sold history is stale, internally split, and cannot measure velocity

The public sold page uses `sold_listings_v`, which joins only
`listing_status_events`. Production had 92 sold events, all from
2026-05-11 through 2026-05-14 and all source `scraper`. Of those, **84 / 92
have `days_since_first_seen = 0`**. The rendered median “0 d” is therefore
an import-coincidence artifact, not market velocity.

A different table, `listings`, holds 2,849 inferred `sold_at` values from
2026-05-17 through 2026-06-07. Those records are omitted from `/sold` and
from demand charts. They should not simply be unioned in: the inference
method, sale-price semantics, duplicates, and active/sold conflicts first
need reconciliation. Until then:

- rename 92 to “captured sold events,” not “sold all time”;
- suppress time-to-sell when first-seen and sold dates were backfilled in
  the same run;
- show both pools and their definitions on the coverage panel;
- hide demand/velocity actions when the newest valid sale is stale.

### 5. The indices are sparse observations, not continuous indices

The combo materialized view refreshed during this audit. Before refresh,
the live page showed 671 combos, two dates, `+0.0%`, and no sparklines.
After refresh, production contained:

| Day | Combo rows | Underlying observation count |
|---|---:|---:|
| 2026-05-09 | 200 | 257 |
| 2026-05-11 | 604 | 1,369 |
| 2026-08-27 | 166 | 265 |
| 2026-08-28 | 95 | 110 |
| 2026-08-29 | 699 | 2,398 |

That is 1,013 combo IDs across **five days**, not 90 days of daily history.
The page cache and refreshed database also disagreed within the same audit,
yet the UI had no “index refreshed at” timestamp.

`v_combo_index_summary` selects 7/30/90-day priors using
`current_date - N`, not `latest_day - N`. For 314 combos whose latest row is
still May 9 or May 11, their own latest row also qualifies as the prior, so
all deltas become 0%. A stale series is thereby rendered as measured
stability. Cutoffs must be relative to each combo's latest day, require two
distinct sufficiently separated observations, and return null when the
latest observation itself is stale.

The four anchor sub-indices are similarly based on only three observed
weeks: 2026-05-04, 2026-05-11, and 2026-08-24. Connecting those points with
a normal line makes a 15-week gap look like a smooth market move. Use points
or broken segments, label `observed weeks: 3`, and expose weekly unique
listing counts.

### 6. Price-history `n` is observation frequency, not market breadth

Production held 45,632 price ticks but only 36,439 unique
`(listing_id, observed_day)` pairs. There were 2,750 listing-days with more
than one tick and a maximum of 14 ticks for one listing-day. Current weekly
medians and combo indices feed all raw ticks into `percentile_cont`, so a
listing scraped repeatedly can influence a period more than an otherwise
identical listing scraped once.

For cross-sectional market prices, reduce to one canonical observation per
listing per bucket (normally the last valid USD-equivalent ask), then take
the median across unique listings. Keep raw ticks only for within-listing
change detection. Report these separately:

- `n listings`: economic sample breadth;
- `n observations`: collection density;
- `n observed days / expected days`: temporal coverage.

`/trends` also selects raw `price` rather than
`price_usd_equivalent`. With USD, CAD, EUR, and GBP now present, its headline
median can mix nominal currencies. Production already had 1,015
`price_history` rows without a USD equivalent. A global price chart must use
USD-equivalent rows or split by currency and disclose exclusions.

### 7. Combo identity needs an ontology, not every trait pair

Migration `0037_observed_combos_and_traits.sql` explodes every pair in a
listing's comma-delimited traits. The live top pairs include:

- `Extreme Harlequin x Harlequin`;
- `Dalmatian x Super Dalmatian`;
- `Red x Red Base`.

Those are often expression levels or overlapping labels, not independent
genetic combinations. Pair co-occurrence also does not prove that the pair
drives price. Add a governed trait ontology with canonical IDs, aliases,
parent/child relationships, het/possible-het state, and exclusion rules.
Require a minimum number of unique listings and sellers before promoting a
pair to an index.

The combo detail route compounds this by building its weekly history from
the first 200 **currently live** matching listing IDs, then mixing their
price ticks with sold-event asks. Historical membership is therefore
conditioned on what is live now. The live Cappuccino × Lilly White page
showed only three weeks, “Earliest $200 / Latest $500,” while its current
table included a 2-pack, a 10-pack, and a wholesale 5/10 lot. Group and
auction listings must be separated from individual-animal comps before any
median, deal, or trend label is emitted.

### 8. Status and regional claims need coverage-aware gating

The global header displayed `Ready`; `/status` simultaneously reported the
site as `Lagging`, listing-detail and seller jobs `Down`, price drops and
status events `Stale`, and several streams with no activity. `Ready` is a
hardcoded design treatment, not an operational state. Replace it with one
computed, linked status summary such as “Partial coverage · listings 2h ·
sales 106d.”

Only 1,572 / 10,239 listings had a non-empty seller location. The production
`region_of()` mapping returned 1,339 US, 102 CA, and 8,798 unmapped rows, with no
EU/UK/AU/JP buckets despite the UI offering them. Regional pricing and
arbitrage must be unavailable until each compared region clears minimum
unique-listing and seller counts. Never infer an arbitrage opportunity from
one populated region or default an unknown breeder region to US.

---

## Design direction: use the Market Analytics preview as the shell, not as evidence

Reference: [Geck Inspect Marketplace Sales Stats](https://geckinspect.com/MarketplaceSalesStats),
Business Tools → Market Analytics preview.

The reference succeeds as information architecture: a compact navy/slate
surface, five KPI cards, a persistent timeframe/filter toolbar, clear
sub-tabs, a live-data strip, dense modular cards, and restrained sans-serif
type. Geck Intellect currently has a polished editorial identity, but the
large serif hero, generous vertical spacing, twelve top-level destinations,
and scrollytelling place atmosphere ahead of decision context.

Copy the preview's **density and hierarchy**, not its numbers. The preview
itself showed a market index and extreme movers that the underlying app
could not support during this audit. A visually credible shell must not make
thin data look more certain.

Recommended desktop composition:

```text
┌ Data coverage: PARTIAL · asks 2h · sold 106d · 5/90 observed days ──────┐
├ Fresh live ads ─ Median fresh ask ─ Valid sold comps ─ Sellers ─ Coverage┤
├ 30d  90d  180d  [region] [age] [trait] [source]   Saved views           ┤
├ NOW | PRICES | DEMAND | COMBOS | REGIONAL | COVERAGE & METHOD            ┤
├──────────────────────────────────────┬───────────────────────────────────┤
│ Main chart with broken outage spans │ Movers / comps with n + as-of     │
│ ask vs sold toggle; unique-listing n│ no action label below quality gate│
├──────────────────────────────────────┴───────────────────────────────────┤
│ Coverage calendar · source mix · exclusions · methodology version       │
└──────────────────────────────────────────────────────────────────────────┘
```

Specific presentation changes:

1. **Trust ribbon first.** Make feed health, last complete catalog pass,
   newest valid sold event, observed days, and stale-live share visible
   before market KPIs.
2. **Use honest KPI nouns.** “Fresh live ads,” “median current ask,” and
   “captured sold events” are auditable. Avoid “market value,” “all time,”
   and “demand” until the supporting definitions pass gates.
3. **Disable unsupported horizons.** A 90d/12mo/24mo button should be
   disabled with “5 observed dates” rather than drawing a line through
   missing months.
4. **Encode missingness in the chart.** Use a broken line and shaded outage
   band, not zero-fill. Tooltips must include date, price semantics, unique
   listings, observations, sellers, and coverage.
5. **Keep filters beside their population.** Every applied filter should
   update the query, URL, `n`, and coverage. If it cannot, render it disabled.
6. **Replace action verbs with evidence verbs.** “Observed asking-price
   increase” is defensible; “Sell into strength,” “accumulate,” “deal,” and
   “arbitrage” are not at low confidence.
7. **Consolidate navigation.** Keep Now, Valuation, Market History, Entities,
   and Methodology in the primary nav. Put empty Shows/Cross-platform and
   experimental tools behind an Explore or Labs area.
8. **Reserve green for verified freshness.** The current forest palette can
   remain as brand color, but green status dots must mean a passed data gate,
   not simply that the page rendered.

### Release gates for any timeline or recommendation card

| Gate | Minimum behavior before display |
|---|---|
| Freshness | Latest observation inside the product's declared SLA |
| Temporal coverage | Show observed / expected buckets; break at gaps; no delta across an outage |
| Sample breadth | Minimum unique listings and sellers, not raw ticks |
| Comparable windows | Non-overlapping windows with adequate data in both |
| Date semantics | `first_listed_at`, `first_seen_at`, `observed_at`, and `sold_at` never silently mixed |
| Price semantics | Ask, inferred final ask, confirmed sale, auction close, and currency normalization explicitly separated |
| Filter integrity | Query result, displayed `n`, URL, and attribution all reflect every active filter |
| Action language | Suppressed when confidence is low or any upstream gate fails |

If those gates are implemented, the Market Analytics preview design becomes
a strong fit: compact, comparative, and useful at a glance. Without them,
the same design would make the current data-quality problems more persuasive,
not less dangerous.

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
labeled and its row-cap bug is fixed. `combo_index_daily` was refreshed
during the reconciliation pass, but it contained only five observed dates;
it is not yet a daily timeline.

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
  cached_traits non-empty       1,197
  of which last_seen >= 08-22   555 / 565

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


---
---

# Audit 2: Geck Intellect through the market-analytics lens

> 🔒 **Second opinion, open preview.** This is an independent audit by a
> second Claude Code session, run 2026-08-29 against the same production
> stack (`geck-data.vercel.app`, Supabase `dhotmtgryuovkmsncdby`, `main`).
> It was researched and drafted **before reading Audit 1 above**, then
> cross-checked against it at the end. Every figure below is labeled with
> its source, and the banner you are reading is modeled on the Market
> Analytics preview in Geck Inspect's Business Tools tab, whose design
> this report follows.
>
> ⛁ Supabase SQL (live) · ☁ GitHub Actions API (live) · 🧮 derived from `main` source · 🕐 queried 2026-08-29 15:00 to 17:00 UTC

**Sections:** [Overview](#overview-what-a-visitor-is-served-today) ·
[Peak findings](#peak-findings-grid) ·
[Index stack](#1-the-index-stack-was-frozen-the-refresh-target-remains-unverified) ·
[Two islands](#2-trait-history-is-two-islands-not-a-timeline) ·
[Invented numbers](#3-numbers-that-are-invented-not-measured) ·
[Sold ledgers](#4-three-sold-ledgers-and-the-public-page-reads-the-worst-one) ·
[Weekly cadence](#5-the-presentation-layer-still-assumes-hourly-data) ·
[Ingest topology](#6-who-is-actually-feeding-this-database) ·
[Cross-check of Audit 1](#cross-check-of-audit-1) ·
[Fix list additions](#fix-list-additions-11-20) ·
[Method](#method-and-one-disclosure)

---

## Overview: what a visitor is served today

The at-a-glance cards, in the style of the analytics preview's Overview
tab. Confidence chips are mine, scored the way the preview scores its
own figures: sample size first, source mix second.

| Card | Value | Trend | Confidence | Source |
|---|---|---|---|---|
| **Market Index** (flagship, `/market`) | **empty state** | n/a | 🛡️ n/a | ⛁ `v_market_index(365)` returns exactly 1 week (2026-05-11); the card needs 2 to render |
| **Live listings** (hero KPI) | **10,158** | n/a | 🛡️ Very low · 6/100 | ⛁ only 565 re-observed in the last 48h; 9,274 unverified since mid-June |
| **Sold stream** (all sold surfaces) | **92 events** | flat since 2026-05-14 | 🛡️ Very low · n=92 | ⛁ `listing_status_events`, no living writer |
| **Trait-combo history depth** | **5 days of data** in a 112-day span | n/a | 🛡️ Low | ⛁ `combo_index_daily` after a full refresh: May 9, May 11, Aug 27, 28, 29 |
| **Price observations** | **45,632 ticks** | 3 islands | 🛡️ Medium as an archive, Low as a series | ⛁ `price_history`, per-day distribution below |

The tick timeline, drawn the way the preview's own `Sparkline` draws it
(it breaks the line at nulls instead of interpolating; every chart in
geck-data should copy that behavior):

```
Apr 22   May 9 ──────────── Jun 9   Jun 10 ┄┄┄┄┄┄┄┄ Aug 26   Aug 27 ── Aug 29
  ▏        ▂▆█▅▂▂▂█▂▂▂▂█▂▂▂▂█▂▁          (78 days, zero ticks)          ▂▁█
 1 tick    ~44,900 ticks, 32 days                                694 ticks, 3 days
```

**The one-sentence verdict, which agrees with Audit 1:** the site
presents a continuous "now" built from two disconnected islands of
history, and every timeline widget bridges the water without telling
you. My pass adds the mechanics: *why* the islands exist, which numbers
are invented rather than measured, and which parts are recoverable this
week without new scraping.

---

## Peak findings grid

Modeled on the preview's Peak Indicators (score, tier, action). Higher
score = more damage to a visitor's decisions right now.

| # | Finding | Score | Tier | Action |
|---|---|---|---|---|
| 1 | Combo index held 5 days of history because nothing had parseable traits to build a combo from; the nightly refresh was healthy but could not report a starved view (corrected finding, see section 1) | 95 | Critical | Fixed 2026-08-29 (migrations 0039 + 0040) |
| 2 | May-June observation era is invisible to every trait/combo timeline (ticks join to canonical rows with empty `cached_traits`) | 92 | Critical | Backfill now |
| 3 | 7d/30d/90d deltas on `/indices` all compare against the same May 9-11 island; today all three columns print the same number per combo | 88 | Critical | Fix now |
| 4 | No current scheduled writer maps the API's `sold` state into the canonical sold ledger | 85 | Critical | Fix this week |
| 5 | `/market` rows render invented values: stddev = 15% of median, days-to-sell defaults to 30 when unknown (today: every combo, since 90d sold_count = 0 everywhere) | 78 | High | Replace with honest empties |
| 6 | Movers and peak scores compare a window to a superset of itself, shrinking every delta toward zero | 70 | High | Fix soon |
| 7 | Weekly ingest cadence breaks the 48h stale banner, the 7-day opportunity gate, and 14-day sparklines by design | 66 | High | Re-tune thresholds |
| 8 | A possible second `geck-check` writer is unresolved, while 104 exact duplicate ticks prove the table lacks deduplication | 60 | Medium | Identify writer + add uniqueness |
| 9 | `/methodology` describes a pipeline that no longer exists (daily scrape, a 14-day sold rule that was never in the code) | 55 | Medium | Rewrite |
| 10 | geck-inspect's `market.json` gets a better sold feed than geck-data's own `/sold` page | 45 | Medium | Unify ledgers |

---

## 1. The index stack was frozen, but not for the reason I first published

> **Correction, same day.** This section originally claimed the nightly
> refresh workflow had never touched this database and told Tennyson to
> go hunting for mis-pointed GitHub secrets. That was wrong, and it was
> wrong in the direction that wastes someone's afternoon. When I went to
> fix the wiring I tested the claim properly and it collapsed. The
> corrected finding is below; the original reasoning is kept visible
> because the way it failed is instructive.

**What I found.** `combo_index_daily` is the materialized view behind
`/indices`, the 60-day sparklines on `/market`, and the gainers/losers
in `/reports`. At 2026-08-29 ~15:30 UTC its newest day was
**2026-05-11**, and the Nightly Index Refresh workflow had ~53 green
runs behind it. I inferred that a working refresh would have pulled
June's 28,000+ ticks in, so the refresh must not be reaching this
database.

**Why that inference was wrong.** June's ticks were never eligible for
the view in the first place. The MV builds combos by splitting
`market_listings.cached_traits` on commas, and every June-era tick
joins to a canonical row whose `cached_traits` is empty (section 2).
So a perfectly healthy refresh would still have produced
`max(day) = 2026-05-11`. My "proof" was consistent with both a broken
refresh and a working one, which means it was proof of neither.

**What the evidence actually says.** Two checks settle it:

- The last nightly run before my query (2026-08-29 13:53 UTC) logged
  `refreshed combo_index_daily` on an HTTP 2xx (read from the job log
  via the Actions API).
- At that moment **zero** trait-bearing listings had a tick newer than
  May 11: the 59 trait-bearing rows behind the Aug 27 ticks were
  imported at 15:04 UTC, over an hour *after* that run. Queried:
  `count(*) = 0` for Aug-27 trait ticks with `imported_at < 13:53 UTC`.

So the nightly refresh has been working, and reaching the right
database, the whole time. The same `SUPABASE_URL` secret also writes
the `scrape_runs` rows this project shows for the sellers and details
workflows, which independently rules out the wrong-project theory.

**The real cause was starvation, not staleness.** The view held five
days of history because only five days had any parseable trait data to
build a combo from. Fixed in migrations 0039 and 0041 (section 2):
after backfilling traits and re-refreshing, the same view went from
**5 days to 32 days** (22 in May, 7 in June, 3 in August), 1,013 to
**2,473** combos and 1,764 to **13,117** rows.

A manual run of the rewired workflow then confirmed the target from CI:
`refresh_combo_index_daily returned 204` followed by
`max_day=2026-08-29 newest_eligible=2026-08-29 lag_days=0 rows=15743`.
That row count only existed in this project at that moment, which
settles the wrong-project question for good.

**Why it matters for "accurate over time."** Audit 1's screenshots
caught the frozen state: every `/indices` delta printed **+0.0%**
(latest day and every "prior" day were the same May 11 row) and every
90d spark column was empty. Audit 1 explicitly left the refresh
question open ("not re-checked in SQL this pass"). Answered: the
refresh was fine, the inputs were not.

**The wiring lesson that survives.** A refresh that returns void and a
workflow that prints success on any 2xx cannot tell "refreshed 15,743
rows" apart from "refreshed five days of nothing." That blind spot is
real and is now closed by `combo_index_health()` (migration 0040),
which compares the newest day the view holds against the newest day it
could build and fails the job when the view is behind.

**And after the refresh it is still wrong, differently.** The summary
view computes `delta_30d` as "latest value vs the newest row at least
30 days old." With a two-island dataset, *every* horizon resolves to
the same May 9-11 baseline. Live values right now (⛁ queried
post-refresh):

| Combo (auto-discovered) | Latest (Aug 29) | delta_7d | delta_30d | delta_90d |
|---|---|---|---|---|
| Harlequin x Tri-color | $290 · n=41 | ▼ 42.0% | ▼ 42.0% | ▼ 42.0% |
| Lilly White x Tri-color | $338 · n=33 | ▲ 50.4% | ▲ 50.4% | ▲ 50.4% |
| Cappuccino x Het Axanthic | $151 · n=28 | ▼ 78.5% | ▼ 78.5% | ▼ 78.5% |

A visitor reads "Cappuccino x Het Axanthic fell 78% this week." What
actually happened: this week's fresh asks are being compared to a
110-day-old bootstrap import, across a regime change, under a column
header that says 7 days. Identical numbers in all three delta columns
are the fingerprint of this bug; the page could self-detect it.

The `/market` sub-indices have the same shape at weekly grain: each
anchor holds exactly **three weekly points** (May 4, May 11, Aug 24; ⛁
`v_market_sub_index_weekly`). The chart draws one continuous line
through a 15-week hole, and because the code labels points with
`week_start.slice(0, 7)`, the x-axis reads "2026-05, 2026-05, 2026-08":
two identical labels and a hidden gap. Axanthic's card headline delta
(about ▼ 38%) is week-of-May-4 (n=6) vs week-of-Aug-24 (n=111), which
is not a market move anyone should trade on.

---

## 2. Trait history is two islands, not a timeline

This is the deepest data finding of my pass, and it explains *why* the
index stack above is so thin even after a successful refresh.

**The dense era is trait-blind.** June 7 alone has 7,290 price ticks
across 6,841 listings. I joined every one of those ticks to its
canonical `market_listings` row: **zero have `cached_traits` populated,
zero have two or more comma-separated tokens** (⛁). The same holds
across the mid-May to June 9 observation stream. The Decodo-era
dual-write created canonical rows without mirroring traits (the
pipe-vs-comma delimiter bug ROADMAP has been flagging since July), so
every trait- or combo-scoped timeline join finds nothing there.

**Result:** after a full refresh, the per-combo daily index contains
exactly five days: **May 9 and May 11** (the bootstrap import, which
did carry traits) and **Aug 27, 28, 29** (the new API ingest, which
stores traits correctly, comma-delimited, 91% coverage). Four weeks of
genuine hourly market observation in May-June contribute nothing to
any trait timeline on the site. They are not lost, they are orphaned.

**The recoverable part, verified.** The scraper-side `listings` table
still holds trait text for **6,343 listings, of which 5,461 map to
canonical rows whose `cached_traits` is empty** (⛁). 3,591 of those
use pipe delimiters and need normalization to commas on the way over.
One backfill UPDATE plus one MV refresh and the May-June era lights up
in `/indices`, `/market` sparklines, sub-indices, and report
gainers/losers, turning the two-island chart into "solid May-June
block, labeled gap, new weekly pulse." That is the single
highest-leverage timeline fix available, and it needs no scraping.

**Semantics still shift between eras, so label them.** May-June ticks
are repeated re-observations of the whole standing catalog (a
stock-weighted view: the same Lilly White contributes every walk).
New-era ticks are one observation per newly listed animal (a
flow-weighted view of fresh asks). Both are legitimate "median observed
market price" definitions; a single unbroken line through both is not.
The methodology page's Zillow comparison only holds if the observation
process is stable, and it changed twice.

---

## 3. Numbers that are invented, not measured

Audit 1's UI pass caught several of these (invented stddev, the
breeder score fallback, the combo-detail zeros, the two-point movers
spark). Completing the inventory with the ones still unlisted, all in
`src/lib/market/queries.ts` on `main`:

| What renders | What the code does | Where |
|---|---|---|
| Days-to-sell per combo row on `/market` | `avg_days_to_sell ?? 30`: missing data renders as a plausible-looking "30" | `fetchCombosRanked` |
| Days-to-sell per breeder | same default of 30 when no events exist, which today is nearly every breeder | `fetchBreeders` |
| Combo detail "median sold" | a weighted **mean** of per-source average prices, labeled median | `fetchComboDetail` |
| Confidence scores on index cards | formulas like `20 + n * 2` capped at 99, unrelated to the 0..99 rubric `/methodology` describes | `fetchMarketIndex`, `fetchMarketSubIndices` |
| Combo sparkline join | MV keys are auto-discovered `"A x B"` ids, crosswalked through the 12 hardcoded display names; anything outside the 12 silently loses its sparkline | `fetchCombosRanked` |

Today these defaults are not edge cases, they are the page: with
`v_combo_rollups(90)` returning **sold_count = 0 for every combo** (⛁
top rows: Lilly White × Axanthic 36 live / 0 sold, Lilly White ×
Cappuccino 33 / 0), every days-to-sell cell on the 90-day view is the
fabricated 30, every spread is a null coerced to 0, and the peak-score
volume term is zero for everyone, which is how "Sell into strength"
ends up stamped on an n=2 combo in Audit 1's screenshot. The preview
app this report is styled after has the right rule in its own banner
code: figures people cannot trace to a source burn breeder trust
faster than missing figures.

Also confirmed at the query layer, since Audit 1 showed the symptom in
screenshots: the landing page's opportunity matcher splits combo names
with a regex whose `x` branch matches with no surrounding whitespace
required, so any combo name containing the letter x inside a word
tokenizes wrong (Axanthic splits into fragments), while the sparkline
matcher four functions away uses the whitespace-safe variant. Same
file, two tokenizers, and that is how a Tri-color Lilly White gets
priced against "Lilly White × Soft Scale."

---

## 4. Three sold ledgers, and the public page reads the worst one

There are three places "sold" lives, and they disagree by 35x:

| Ledger | Rows | Last movement | Who reads it |
|---|---|---|---|
| `listings.sold_at` (scraper inference) | **2,849** | 2026-06-07 | nobody in the UI directly |
| `market_listings.current_status = 'sold'` | **81** | with the era | hero "sold all-time", rollup sold medians |
| `listing_status_events` status=sold | **92** | 2026-05-14 | `/sold` table AND chart, days-to-sell histograms, `/trends` demand, the market index |

Structural facts behind that, from the migrations and scripts on
`main`:

- Migration 0013 bridged scraper solds into the canonical schema
  **once**, in May. The bridge was never a pipeline: it caught the 81
  rows whose scraped page said "sold out" at upsert time, not the
  2,849 availability-flip inferences.
- The only ongoing writer (`mark_unseen_listings_inactive` via the
  weekly resync) updated the scraper table only, never canonical, and
  its calling workflow was deleted from the repo today.
- The new API ingest maps availability to sold by matching the strings
  "soldout", "outofstock", "discontinued". MorphMarket's API uses
  `state: "sold"`, which matches none of them. Even a listing captured
  after it sold would be recorded as live. (Today all 565 new rows are
  `for_sale`, so this is a landmine rather than a live bug.)

So the answer to "how well is historical data integrated into the sold
timelines" is: the richest sold history the project owns (2,849
May-June comps with real dates) has never reached a single public
sold surface. Meanwhile `/data/market.json`, the feed geck-inspect
consumes, is the *only* reader that unions all three ledgers, so the
companion app is served a materially better sold dataset than
geck-data's own `/sold` page. It also backfills a missing sold date
with the listing's first-listed date, which quietly turns "listed
February, sold unknown" into "sold February" downstream.

One honest sentence for the UI until sold flows again: "We have not
been able to observe sales since June 7." Every demand widget should
say it or hide.

---

## 5. The presentation layer still assumes hourly data

The site was designed against an hourly Decodo walk. The feed is now
(at best) one API pulse per week. Contracts that break on cadence
alone, before any data quality issues:

- **`StaleDataBanner` fires on a healthy schedule.** Threshold 48h
  against `max(last_seen_at)`. Under Monday-pulse cadence the banner
  will read "Data feed interrupted: no new market data for N days" from
  roughly Wednesday to the next Monday, every single week the pipeline
  works as designed. Audit 1 showed the banner is too easy to *clear*
  (one fresh batch hides 9,274 zombies); it is also too eager to
  *fire*, and a banner that cries wolf five days a week trains
  visitors to ignore the one outage that matters. Both problems have
  the same fix: key it on catalog re-observation coverage, not the max
  timestamp, and say "weekly feed, last pulse Monday" instead of
  "interrupted."
- **The opportunities gate empties itself by Sunday.** The 7-day
  `last_seen_at` gate is exactly one pulse wide. Any Monday delay
  briefly zeroes the panel; by Sunday it is one week of new listings
  compared against 365-day-old combo medians.
- **14-day sparklines under a weekly writer are one or two spikes**
  (Audit 1 flagged the `first_seen_at` bucketing; the cadence makes it
  worse: even with perfect `first_listed_at` bucketing, a
  weekly-refreshed 14-day window will always look like a cliff and a
  wall, so the window itself should widen or the copy should say
  "this week's arrivals").
- **The timeframe selector offers 24 months** over a dataset whose
  first canonical observation is 2026-05-09. Three of the five
  options (6mo, 12mo, 24mo) currently return identical data.
- **`/methodology` describes a different pipeline.** "Scraped daily"
  (it is weekly, after 11 weeks of nothing); "we infer a sale when the
  scraper has not seen a listing for 14+ days" (the actual RPC flips
  everything unseen since the current run started, with no grace
  period, and nothing calls it anymore); the market index section
  still describes the sold-based basket while the page above it
  renders that index's empty state. The page's own closing rule says
  chart copy the methodology cannot back is a bug. Agreed, and today
  that clause indicts the methodology page itself: last reviewed
  2026-05-22, three regime changes ago.

Two smaller presentation truths in the same family: the per-listing
price chart plots ticks at equal spacing with no time axis, so four
May observations and one August observation read as a smooth five-step
line; and the landing scrollytelling samples `market_listings` with a
bare `limit(5000)` and no ordering, which hands chart panels an
arbitrary, era-mixed subset of the catalog that can silently change
between deploys.

---

## 6. Who is actually feeding this database

The repo tells one story, the run log another (⛁ `scrape_runs`, ☁
Actions API):

- The Monday weekly API workflow was committed to `main` **today at
  10:34 Denver time** and has **zero runs** in GitHub Actions. Its
  first scheduled fire is Monday, Sep 1.
- The ingests that actually revived the feed were triggered by
  something called **`geck-check-morphmarket-api`** (Aug 28, 84
  records) and **`geck-check-morphmarket-api-weekly`** (Aug 29, 556
  records). The string "geck-check" appears nowhere in this
  repository. That label may indicate an external runner, a one-off
  manual audit invocation, or another system; `triggered_by` alone does
  not prove that a persistent second schedule exists.
- Overlap is already visible: **104 (listing, timestamp) pairs are
  duplicated** in `price_history`, which is insert-only with no
  unique key. This proves a deduplication gap, not which writer caused it.
  If two writers walk overlapping 168h windows, they will grow that number
  and quietly double-weight Monday medians.
- The two observed runs stamp time differently: the Aug 28 run's ticks
  landed backdated to the listings' real listing dates (Aug 27/28),
  while the Aug 29 run's 610 ticks all carry the ingest timestamp
  itself. Same table, two clock conventions, and the daily index
  inherits whichever ran last.

Nothing here is fatal, but before Monday determine whether `geck-check` is
a persistent writer. If it is, choose one schedule. In either case, add a
uniqueness/upsert rule so repeated observations cannot be counted twice.

---

## Cross-check of Audit 1

I read Audit 1 (including its live-site screenshot pass and UI-pass
addendum) only after completing the investigation above.

**Confirmed independently, number for number:** 10,239 canonical rows,
10,158 live vs 565 fresh, 81 canonical sold vs 2,849 frozen scraper
solds vs 92 events, the 78-day tick hole (my per-day distribution
matches their weekly one), 1,670 `first_listed_at`, 100% species
unknown, the run log (694/695 as the geck-check runs), and the
diagnosis that `/trends` draws the outage as a market crash. Our two
passes started from opposite ends (they went page-first, I went
pipeline-first) and met at the same verdict, which is itself a useful
signal that the verdict is right.

**Their open question, narrowed.** Audit 1's UI pass ends with:
closest daily series is `combo_index_daily` "if that materialized view
is actually refreshed (not re-checked in SQL this pass)." It had never
been refreshed *usefully*, though not for the reason I first wrote:
the refresh was running fine and the view was starving for want of
parseable traits. See section 1 for the correction and the evidence
that settles it. Their screenshotted "+0.0% everywhere" became
"identical large deltas in all three columns" after the first refresh,
and is now backed by 32 days of real history after the 0039 backfill.

**Refinements to their findings:**

- Their `/reports` note said gainers/losers are "noise or empty" *if*
  the MV was stale. Confirmed stale-since-creation at screenshot time;
  post-refresh, August-vs-July mover math still compares a 3-day
  ask-only island against an empty month.
- Their `/combo/lw-axa` screenshot ("caption says 26 weeks, pill says
  3 weeks, looks like a -42% collapse") is exactly the three-point
  sub-index series from section 1; the -42% is week-of-May-4 n=6
  against the new era.
- Their recommendation 4 (bucket sparklines on `first_listed_at`) is
  right and needs one addition: the new era's `price_history`
  timestamps are mostly ingest-time, not listing-time (610 of this
  week's 694 ticks carry the Aug 29 run stamp), so tick-based
  timelines need the same treatment, not just the arrival sparklines.
- Their freshness table row "StaleDataBanner will not fire" is true
  this week and inverts next week: under the new weekly cadence it
  fires falsely from midweek onward (section 5). The fix is the same
  coverage-based rule they proposed; I would add explicit copy for
  "weekly pulse" mode.
- Their earlier trait count (1,154 with `cached_traits`, later 1,197 as
  run 695 completed) is the symptom; the
  consequence is that trait/combo timelines contain five days of
  history total, and 5,461 of the missing rows are recoverable from
  the scraper table today without any new scraping (section 2).

**Where I would push back:** their fix list item 3 ("draw the hole as
an outage, not zeros") should extend to the
delta layer: it is not enough to draw the gap, the 7/30/90d
comparators must refuse to reach across it (a max-age bound on the
baseline row), otherwise the charts become honest while the printed
percentages stay wrong. The final reconciliation also narrows this
audit's original "wrong database" claim: it is a strong hypothesis from
the most recent eligible run, not a demonstrated secret value.

---

## Fix list additions (11-20)

Audit 1's items 1-10 stand. These are the additional fixes my pass
surfaced, in leverage order:

11. ~~**Verify the nightly refresh target and add a postcondition.**~~
    **Done 2026-08-29.** The target was already correct: the same
    `SUPABASE_URL` secret writes this project's `scrape_runs` rows, and
    the 13:53 UTC job log shows a successful refresh. Do not re-point the
    secrets. The missing postcondition is now `combo_index_health()`
    (migration 0040), called by `.github/actions/refresh-indices`, which
    fails the job when the view sits behind the newest day it could
    build. The check is lag-against-input rather than "did max(day)
    move", because under a weekly ingest most nights add nothing and a
    movement check would false-alarm six days a week.
12. ~~**Backfill canonical traits from the scraper table.**~~
    **Done 2026-08-29, migrations 0039 + 0041.** Trait coverage went
    1,154 to 6,485 rows; `combo_index_daily` went from 5 days to 32 days
    of history (22 in May, 7 in June, 3 in August) and 1,013 to 2,473
    combos. `canonical.py` now normalizes on write so the scraper cannot
    re-create the problem.

    Worth recording how the first attempt failed, because it is the same
    trap the vocabulary cleanup keeps falling into. 0039 split on pipe
    and comma at once. The scrapers emit `Diet: Cricket, Meal
    Replacement | Proven breeder: No | Harlequin, Partial Pinstripe`,
    where pipes separate properties and commas list values *inside* one
    property. Flattening both dropped the `Diet:` head but kept its
    values, so the top combos on `/indices` briefly became `Harlequin x
    Meal Replacement` (n=159) and `Meal Replacement x Roach`. 0041
    re-parses pipe-first, dropping a non-trait property whole, and
    rebuilds the affected rows. Zero diet values and zero fake combos
    remain.
13. **Bound every delta's baseline age.** `delta_7d/30d/90d` (and the
    movers math) should return null with a "no baseline in window"
    chip when the comparison row is older than the labeled horizon by
    more than a tolerance, instead of silently comparing to May.
14. **Bridge the 2,849 scraper solds into canonical, labeled
    inferred, with their May-June inference timestamps.** `/sold` becomes an
    honest frozen archive ("last observed sale June 7") instead of a
    92-row curiosity, and `/whats-it-worth` gets its comps pool back.
15. **Replace invented values with honest empties**: the 30-day
    days-to-sell defaults, the 15% stddev, the sort-order breeder
    score, the mean labeled median. The widgets already have empty
    states; use them.
16. **Compare disjoint windows in movers and peak scores** (current w
    vs the preceding w, not w vs 2w), and suppress the cards entirely
    while one side of the comparison has no sold data.
17. **One tokenizer.** Unify the landing page's two combo-name
    splitters on the whitespace-safe variant, then move both to the
    shared parser the vocabulary cleanup lands.
18. **Resolve whether a two-writer race exists before Monday** (repo
    workflow vs the `geck-check` trigger) and add a unique index or upsert
    key on `price_history (listing_id, observed_at)` so overlapping walks
    cannot double-count regardless of the source.
19. **Unify the sold read path** on the same three-ledger union
    `market.json` already uses, and stop backfilling missing sold
    dates with listing dates in that feed.
20. **Rewrite `/methodology` to describe the weekly-pulse reality**,
    including the two observation regimes, the gap, and the actual
    sold-inference rule, and stamp it with a review date that is not
    from a dead pipeline's era.

---

## Method, and one disclosure

- Read the full data path on `main`: landing snapshot and
  scrollytelling, `market/queries.ts`, freshness and stale banner,
  `/sold` libs, `/indices`, `/trends`, `/reports/[month]`,
  `/methodology`, `/listings/[id]`, `market.json`, migrations 0002,
  0005, 0011, 0013, 0035, 0036, 0037, 0038, the sold-activity RPC,
  `scrape_listings.py`, `scrape_listings_api.py`, `canonical.py`, and
  the Actions workflow files and run history.
- Production SQL through the Supabase connector; the pg_matviews and
  pg_proc definitions were read from prod, not assumed from the
  migration files (that difference is finding 1).
- **Disclosure: one intentional write.** At ~16:45 UTC I called
  `refresh_combo_index_daily()` once against production to test
  whether the refresh function works (it does; that is the proof in
  section 1). Side effect: `/indices`, `/market` combo sparklines, and
  report movers now show post-refresh values, so Audit 1's screenshots
  (taken before) will not match the live site (after). No rows were
  modified in any base table; the change is exactly what a working
  nightly refresh would have done, minus the parts of it that are
  still broken (sections 1 and 3).
- Styled after `src/components/market-analytics/` in geck-inspect
  (banner, source badges, confidence chips, peak grid, gap-honest
  sparklines), per the audit request. One observation carried back
  from that codebase: its shared `Sparkline` already segments series
  at nulls instead of interpolating, which is precisely the drawing
  rule every geck-data timeline needs.
