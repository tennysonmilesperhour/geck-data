# Geck Intellect: Long-Term Roadmap

Written 2026-07-07 from a full audit of this repo, the production Supabase
project, and the GitHub Actions pipeline. This document is designed to be
handed to any capable AI model (or human) and executed phase by phase.
Companion docs: `CONTEXT.md` (what this is), `INTENT.md` (the original
four-phase spec, now mostly shipped), `ARCHITECTURE.md` (code inventory),
`DECISIONS.md` (running decision log).

The one-sentence diagnosis: **the product surface is 80% built, but the
data underneath it is dead, thin, and in places dishonest, and the feature
set is wider than it is deep.** The route to "genuinely useful for gecko
breeders and sellers" is not more pages. It is: resurrect and harden the
data pipeline, make every number trustworthy and labeled honestly, collapse
the sprawling UI into a few excellent workflows, and then build the two or
three killer features (pricing, alerts, market history) on top of data that
actually flows.

---

## Part 1: Verified current state (July 2026)

Everything in this section was verified directly against production during
the audit, not inferred from code.

### The pipeline is down. This invalidates everything else until fixed.

- **Scrapers dead since June 9.** Every Decodo proxy request has returned
  HTTP 429 for four weeks. Each hourly GitHub Action retries 5x per page,
  burns its 15-minute timeout, and is cancelled. `scrape_runs` shows
  hundreds of "running" rows that never finished. Last successful listings
  scrape: 2026-06-09. Likely cause: the $19/mo Decodo plan's 19k
  request/month quota is exhausted or the subscription lapsed. Only the
  image downloader (which does not go through Decodo for MorphMarket pages)
  still succeeds.
- **Extension silent since May 14.** Last `ingest_audit` row is
  2026-05-14. The Eye in the Sky extension has not POSTed an event in
  almost two months (broken, logged out, or simply not being used).
- **Nothing alerted on either failure.** `/api/status.json` only watches
  the extension stream (`ingest_audit`), so a completely dead scraper
  pipeline still reports healthy. GitHub Action cancellations notify
  no one. The site has been serving month-old data with freshness badges
  that literally render `Date.now()` as "updated just now"
  (`MarketIndexCard.tsx:112`, `sellers/page.tsx:188`, `sold/page.tsx:118`).

### The data that exists is thin and partly mislabeled

Production row counts (2026-07-07):

| Table | Count | Note |
|---|---|---|
| market_listings | 9,674 | ALL have `species='unknown'`; species routing never classified anything |
| price_history | 44,938 ticks | 9,355 distinct listings; 0 ticks in last 7 days |
| listing_status_events (sold) | 92 total | 0 in last 30 days; this is the entire "sold" dataset |
| price_drops | 2,553 | frozen since June 9 |
| market_sellers | 910 | seller_snapshots: 0 rows |
| listing_lineage / auction_results / cross_platform_listings / show_mentions | 0 | aspirational tables, no writers active |
| alerts / profiles | 0 / 1 | effectively zero users |
| morph_taxonomy / combo_catalog | 10 / 12 | tiny vs. the ~42-row crested_morph_taxonomy |

Implications to internalize:

1. **There is no real sold-price dataset.** 92 events ever. Everything
   labeled "sold" in the UI and in `market.json` (where
   `sold_price = ask price` is imputed at `data/market.json/route.ts:384`)
   is actually ask-price data. Migration 0036 already pivoted the indices
   to observed prices (Zillow-ZHVI style), which is the right call, but the
   ask-vs-sold conflation still leaks unlabeled into multiple surfaces.
2. **There are no users yet.** 1 profile, 0 alerts, ~1 user event in 30
   days. The long-term plan must include adoption work, not just features.
3. **Schema drift: repo migrations != prod.** Migrations 0028, 0030, 0031
   were never applied to prod (checked `supabase_migrations.schema_migrations`).
   `user_notification_channels`, `listing_views`, `listing_favorites`, and
   `batch_jobs` do not exist in production, so the alert delivery pipeline
   and demand-signal features cannot work even if the code is correct.
   Additionally, RPCs the scrapers depend on
   (`mark_unseen_listings_inactive`, `listings_needing_detail_scrape`,
   `listings_needing_image_download`) were created by hand in the SQL
   editor and exist in no migration file: a DB rebuild would break the
   scrapers.

### Confirmed correctness bugs (each verified in code)

1. **Trait delimiter bug (data-corrupting).** The scraper writes
   `cached_traits` pipe-delimited (`scrape_listings.py:270`,
   `"|".join(trait_names)`), but migration 0037's `v_observed_traits` /
   `v_observed_combos` / `combo_index_daily` split on commas
   (`string_to_array(ml.cached_traits, ',')`). Every scraper-sourced
   listing collapses to one fake trait token like `Lilly White|Axanthic`
   and never forms combos. The auto-discovered combo/trait universe is fed
   almost entirely by the (dead) extension stream.
2. **Alerts are end-to-end broken.** `WatchButton` writes queries shaped
   `{kind, seller_id|term|combo}` (`WatchButton.tsx:18-21`), but the
   matcher only understands `{species, trait_all, trait_any, min_price,
   max_price, regions, must_be_drop, seller_ids}` (`matcher.ts:29-38`).
   Unknown keys are ignored, so every UI-created watch matches essentially
   every crested listing. The one matcher-compatible creation path
   (`POST /api/alerts/from-url`) has no UI. There is no UI to add a
   notification channel, no ack/snooze/delete UI, and the email channel is
   a no-op stub (`notify.ts:198-201`). Nothing in this pipeline can
   actually deliver a useful alert today.
3. **`combo_index_daily` is a materialized view that nothing refreshes.**
   `refresh_combo_index_daily()` exists; zero crons or routes call it.
   `/indices` and every sparkline reading it are frozen at the last manual
   refresh.
4. **`searchResultBatch` resurrects sold listings.** The bulk update at
   `events.ts:347` forces `current_status='live'` without preserving
   terminal states (unlike `touch_listing_seen`).
5. **Two combo vocabularies.** Fair-price and recent-sales still use the
   hardcoded 12-combo `_combo_id_from_traits` (migration 0029) while
   `/indices` uses 0037 auto-discovery. `/whats-it-worth` and `/indices`
   literally disagree about what combos exist.
6. **Synonyms never wired in.** `morph_taxonomy_synonyms` and
   `resolveSynonym` exist but the combo matcher and market.json cascade
   never call them; "Lily White" and "Cappucino" misspellings silently
   fail to match. There are also four divergent trait tokenizers
   (`combos.ts`, `traits.ts`, `matcher.ts`, `trait-premium.ts`) with
   different rules; `trait-premium.ts` lacks the key:value filter and
   leaks pseudo-traits like "meal"/"replacement" into premium stats.
7. **Fabricated numbers presented as data.** `fetchCombosRanked` invents
   `stddev = median * 0.15` (`queries.ts:279-299`); breeder lineage scores
   fall back to `30 + (idx % 60)` positional noise (`queries.ts:774-911`);
   Top Movers deltas compare a window against a *containing* superset
   window, biasing toward zero; `DataFreshness` gets `Date.now()`.
8. **Three disagreeing region parsers** (combo page, trait page, region
   page, plus the matcher's fourth) can bucket the same listing into
   different regions on different pages.
9. **Raw `error.message` leaked to end users** on at least 7 pages
   (`sold:80`, `price-drops:55`, `sellers:51`, `shows:42`,
   `cross-platform:52`, `watchlist:66`, `alerts:68/89`).
10. **No application-level rate limiting** on any public endpoint; the
    api-docs page's "we may throttle" is aspirational.
11. **Docs contradict behavior**: api-docs says market.json updates
    "roughly hourly"; the route sets `s-maxage=300`.
12. **Duplicate scrape workflow**: the daily listings job is 100% subsumed
    by the hourly one (same DELTA_WALK, shared concurrency group).

### UX / IA state

- **12 nav tabs in 3 groups, plus two disconnected admin areas**
  (`/admin/*` and `/data-admin/*` never cross-link). Sellers are ranked in
  4 different places, combos in 4, regional views in 5, "is the market
  hot" in 4 widgets on one screen. `/indices` and `/market > Combos` are
  near-duplicates.
- **Orphan pages**: `/status` and `/api-docs` have zero inbound links.
  `/region/[code]` has no index and one inbound link.
- **Two visual identities**: `/market` and `/whats-it-worth` use a green
  "forest" theme; everything else slate "ink". Feels like two products.
- **Landing filters and the price estimator are not URL-shareable**
  (React context / useState only), while `/market`, `/sold`, `/trends`,
  `/compare` are. The single most shareable artifact (a price estimate)
  cannot be linked.
- **No route-level `loading.tsx` anywhere**; heavy pages block on
  force-dynamic fetches.
- `/reports/[month]` renders all 12 months against *today's* data
  (synthesized, admits it in the footer). Misleading as shipped.

### Data visualization state

- **Four parallel viz subsystems** (D3 chart pack + registry, market
  widgets, landing CSS bars, bespoke page charts) with three color
  palettes and two tooltip models. All dark-only with hardcoded hex.
- **8 of 14 registered charts are unreachable dead code**: they're
  registered to a `page="home"` ChartGrid that is mounted nowhere
  (only `/sellers` and `/sold` mount grids). The settings panel offers
  toggles for charts that cannot render. The presets system's visible
  differences are entirely within that dead `home` config.
- The decorative charts (Sunburst grouping traits by first word,
  ForceGraph hairball, RidgePlot with no value axis) don't answer
  breeder/seller questions even where reachable.
- D3 charts read `clientWidth` once with no ResizeObserver (broken on
  rotate/resize), use native `<title>` tooltips, and render silent empty
  SVGs with no message when data is thin.
- **The highest-value viz primitives are missing**: no price-over-time
  with a confidence ribbon anywhere (sparklines only), no "market
  distribution + marker where YOUR gecko sits" overlay, no live price
  ladder of comps. Meanwhile `/whats-it-worth` (the strongest feature) is
  well-built but buried as a standalone page and its comps are a table,
  not a visual.

### What is genuinely good (keep and build on)

- `/whats-it-worth` + `/api/market/fair-price`: percentile bands, trait
  multipliers, recent comps with links, honest confidence tiers. This is
  the product's soul.
- The canonical URL filter schema (`src/lib/filters/`) and entity pages
  (`/combo`, `/trait`, `/region`, `/sellers/[id]`, `/listings/[id]`).
- The ingest architecture (auth, HMAC option, audit, legacy adapter,
  idempotent upserts, species routing hooks) is well built even though
  its inputs are currently silent.
- `/methodology` exists and is honest. The empty states on market widgets
  "tell the truth." MiniSparkline is a good shared primitive.
- Indices-in-Postgres (materialized view + refresh function) is the right
  architecture; it just needs a scheduler and fresher inputs.
- The test suite that exists (62 unit tests) is real; it just doesn't
  cover the highest-stakes paths (market.json contract, indices, premiums).

---

## Part 2: North star and product principles

**North star:** a crested gecko breeder or seller can answer, in under a
minute each, with numbers they can trust:

1. *"What is this gecko worth right now?"* (pricing)
2. *"Is the market for X heating up or cooling down?"* (trend)
3. *"Tell me when something I care about happens."* (alerts)
4. *"How is my inventory / my listings doing vs. the market?"* (seller ops)

Principles for every phase below:

- **Truth over polish.** Every number is labeled with what it actually is
  (ask vs sold vs observed), carries a sample size, and degrades to an
  honest empty state. Never fabricate (no synthetic stddev, no fake
  freshness, no positional-noise scores).
- **Depth over breadth.** Fewer pages, each excellent. Kill or merge
  anything that doesn't serve the four questions.
- **The pipeline is the product.** A market-data tool with a dead pipeline
  is a screenshot. Pipeline health gets alerting, budget guards, and a
  visible freshness banner before any new feature ships.
- Respect the standing constraints: shared Supabase (three consumers; do
  not change semantics of `market_listings`, `morph_taxonomy`,
  `listing_images` without checking eyeinthesky + geck-inspect), crested
  only on read paths, D3 only, no new state libraries without sign-off,
  direct-to-main workflow per `CLAUDE.md`, no em dashes anywhere, plain
  English comments for a non-coder stakeholder.

---

## Part 3: The phased plan

Phases are ordered by dependency, not preference. Each has an acceptance
bar you can feel. Rough effort assumes focused AI-assisted sessions.

### Phase R: Resuscitate (do first, ~1-2 sessions)

Goal: data flows again and can never silently die again.

1. **Restore the scrape feed.** Check the Decodo dashboard: quota vs
   subscription. Options in order of preference: (a) renew/upgrade Decodo
   and add a monthly budget guard in `decodo_client.py` (track request
   count in `runtime_config`, hard-stop at ~90% of quota); (b) swap
   provider (ScraperAPI/Zyte/BrightData) behind the existing client
   interface, which is already isolated in `scripts/lib/decodo_client.py`.
2. **Fail fast, loudly.** In the scrapers: after N (say 5) consecutive
   fully-failed pages, abort the run and mark `scrape_runs.status='failed'`
   with the real error (today: 15 minutes of doomed retries, then a
   cancelled job that records nothing). In the workflows: add a failure
   step that POSTs to a Discord webhook (secret already exists for alert
   channels; reuse the mechanism).
3. **Pipeline observability.** Extend `/api/status.json` (and `/status`)
   to include `scrape_runs` freshness per scrape_type, not just extension
   ingest. Add a site-wide stale-data banner component: if
   `max(market_listings.last_seen_at)` is older than 48h, every public
   page says so plainly. Delete the `DataFreshness updatedAt={Date.now()}`
   lie and pass real timestamps.
4. **Revive or retire the extension stream.** Diagnose why Eye in the Sky
   stopped POSTing (check the extension repo, auth key, MorphMarket layout
   change). If it can't be revived promptly, the sold-inference and
   auction/cross-platform features that depend on it should surface
   "extension feed offline since <date>" rather than silently emptying.
5. **Schema reconciliation.** Apply the missing migrations (0028, 0030,
   0031) to prod after review; capture the hand-created RPCs
   (`mark_unseen_listings_inactive`, `listings_needing_detail_scrape`,
   `listings_needing_image_download`) into a new migration file; verify
   repo `ls supabase/migrations` matches `supabase_migrations.schema_migrations`
   one-to-one and document the mapping in DECISIONS.md.
6. **Schedule the index refresh.** Nightly GitHub Action (or pg_cron)
   calling `select public.refresh_combo_index_daily();`. Also schedule
   the deferred `POST /api/training/refresh-adjustments` weekly cron.
7. **Kill the duplicate daily listings workflow.** Delete
   `scrape-listings-daily.yml`; the hourly cron covers it.
8. **Backfill the gap.** After the feed is restored, run the weekly-resync
   sweep manually to re-baseline active/inactive status (a month of sold /
   delisted animals is currently marked live).

Acceptance: `/status` shows every stream green with timestamps under 24h;
killing the Decodo key on purpose produces a Discord ping within one
scheduled cycle and a visible stale banner on the site within 48h.

### Phase T: Truth (data correctness, ~3-4 sessions)

Goal: every number on the site is real, labeled, and consistent.

1. **Fix the trait delimiter bug.** Either normalize at write time
   (scraper joins with `", "`, plus a one-time backfill
   `update market_listings set cached_traits = replace(cached_traits,'|',', ') where cached_traits like '%|%'`)
   or make the 0037 views split on both. Prefer write-time normalization +
   backfill so there is exactly one convention. Re-run the 0037 views and
   refresh the MV afterward; confirm observed-combo counts jump.
2. **One tokenizer, one vocabulary.** Consolidate the four trait
   tokenizers into `src/lib/traits.ts` (keep `combos.ts` matching logic,
   have it consume the shared tokenizer). Wire `resolveSynonym` into the
   matcher path and the market.json cascade. Retire the 12-combo
   `_combo_id_from_traits` hardcode: point `v_combo_price_distribution`
   and `v_recent_combo_sales` at the 0037 observed-combo universe (or a
   curated `combo_catalog` grown from it), so fair-price and indices agree
   on what combos exist. This is a migration + view rewrite; flag it since
   fair-price is consumed by geck-inspect.
3. **Ask vs sold honesty pass.** market.json: stop imputing
   `sold_price = ask`; emit `last_ask_price` and a `sold_price_confidence`
   or null (coordinate with geck-inspect's consumer before changing field
   semantics; additive fields first, deprecate later). UI: everywhere a
   number derives from asks/observations, label it "ask" or "observed"
   (the methodology page already explains the ZHVI-style choice; the
   widgets don't). Remove fabricated stddev, positional-noise breeder
   scores, and fix the Top Movers overlapping-window delta (compare
   window N vs the *prior disjoint* window).
4. **Fix `searchResultBatch` terminal-state clobbering** (preserve
   sold/removed like `touch_listing_seen` does).
5. **One region parser** in `src/lib/market/regions.ts`, used by combo /
   trait / region pages and the matcher. Unit test it.
6. **Species routing that works.** All 9,674 rows are `unknown`. Write the
   classifier (title/category keywords already exist in `species.ts`),
   backfill, and make the scraper set species on the canonical mirror.
   Keep views reading `('crested','unknown')` until the backfill is
   trusted, then tighten.
7. **Friendly errors + rate limiting.** Replace raw `error.message` panels
   with a shared error component (log the detail server-side). Add a
   simple token-bucket (per-IP, per-route, in-memory or Upstash-free-tier
   is a dependency decision; even a coarse in-memory limiter beats none)
   to the public API routes. Fix the api-docs/cache contradiction.
8. **Tests for the load-bearing paths.** Contract test for market.json
   (vocabulary mapping, combo cascade, sold semantics), unit tests for
   trait-premium and the queries.ts heuristics you keep, snapshot test for
   the filters schema roundtrip (exists), and a CI check that fails if
   `supabase/migrations` and prod drift (script comparing migration lists
   via a read-only connection, run in the existing ci.yml).

Acceptance: a listing scraped with traits "Lilly White|Axanthic" appears
under the lw-axa combo everywhere; /whats-it-worth and /indices report the
same combo universe; nothing on the site displays a number the methodology
page can't explain; `tsc --noEmit` and the grown test suite pass in CI.

### Phase U: UX consolidation (user flow + IA, ~4-5 sessions)

Goal: a first-time breeder lands, understands, and reaches an answer to
one of the four north-star questions in under a minute.

1. **Collapse the nav to 6 destinations** (from 12 + orphans):
   - **Pulse** (`/`): keep as the launchpad, but make its filters write
     the canonical URL schema instead of React context so every view is
     shareable.
   - **Price a gecko** (`/whats-it-worth`, promoted): move it first in the
     nav; make estimator state URL-encoded (`?traits=...&age=...&sex=...`)
     so estimates are shareable links; embed the distribution-overlay viz
     (Phase V) and visual comps.
   - **Market** (`/market` absorbs `/indices` and `/trends`): Indices
     becomes the Combos tab's top strip (they're near-duplicates already);
     Trends becomes a "Over time" tab. One green/ink theme decision made
     site-wide (pick one; recommend ink with the market accent as a
     secondary, applied everywhere).
   - **Sold & comps** (`/sold`, absorbs `/price-drops` as a filter chip
     `?event=drop`).
   - **Sellers** (`/sellers`, absorbs the Breeders tab's ranking; the
     `/compare` page becomes a "Compare" mode reachable from seller/combo
     pages, since any-two-entities compare was never finished).
   - **My Geck** (auth): merge `/watchlist` + `/alerts` into one page
     (they are two views over the same table); add channel setup and
     ack/snooze here (Phase A below).
   - Move `/shows` + `/cross-platform` under Market as minor tabs or park
     them until their feeds are live (they're empty tables today; showing
     empty ops pages to users erodes trust).
   - Footer links: `/methodology`, `/api-docs`, `/status` (de-orphaned).
     Cross-link the two admin areas for the operator.
2. **First-run experience.** A dismissible "what is this" strip on Pulse
   (three sentences + the four questions as buttons). The market
   OnboardingPanel pattern already exists; generalize it.
3. **Loading + empty consistency.** Add `loading.tsx` skeletons for the
   heavy routes; adopt the market EmptyState component app-wide; every
   chart's empty state says *why* (insufficient data vs pipeline stale vs
   filters too narrow) - the three causes exist and are currently
   indistinguishable.
4. **Mobile pass.** The header drawer works; fix chart resize behavior
   (Phase V), table-to-card collapse on the main tables, and verify the
   four flows on a phone viewport.
5. **Watch affordance honesty.** WatchButton shows "already watching"
   state on load (query alerts on mount), dedupes, and (until Phase A
   ships) is labeled "Save to watchlist" rather than promising alerts.
6. **Reports become real.** `/reports/[month]` only renders months for
   which a snapshot row exists; add a monthly GitHub Action that writes a
   `market_report_snapshots` row (JSON of the computed aggregates) on the
   1st. Historical months become immutable and honest.

Acceptance: nav has 6 entries; every page reachable from the header or a
footer; landing filter state and a price estimate survive copy/paste of
the URL into a fresh browser; a phone user can run all four north-star
flows; no page shows an unlabeled empty chart.

### Phase V: Visualization overhaul (~4-5 sessions, overlaps U)

Goal: one coherent chart system whose flagship visualizations directly
answer breeder/seller questions.

1. **One theme.** Single `chart-theme.ts` exporting CSS-variable-backed
   tokens (light + dark), one categorical palette (anchor-morph colors
   already exist in `e2ef888`, extend them), one semantic pair for
   up/down. Every chart and widget reads it. Kill the three-palette split
   and hardcoded hex.
2. **One interaction standard.** Shared tooltip/crosshair (the
   `InlineCharts.AreaChart` implementation is the best; extract it),
   ResizeObserver-based sizing hook for all D3 charts, an in-chart
   insufficient-data message component, and sample-size encoding (fade or
   dash line segments where weekly n < 5; the confidence data exists).
3. **Build the three killer primitives:**
   - **PriceBandOverTime**: median line + p25-p75 ribbon + n-shading,
     time-brushable. Deploy on `/combo/[slug]`, `/trait/[slug]`, and the
     Market "Over time" tab. Data: `combo_index_daily` (already has
     sample_size) + a percentile extension to the MV.
   - **WhereDoesMineSit**: the market price distribution for the selected
     combo/traits as a density strip with a marker at the user's price,
     percentile callout ("your ask is at the 72nd percentile, typical
     range $340-520"). Deploy on `/whats-it-worth` (replacing the static
     PriceBar) and `/listings/[id]`.
   - **PriceLadder**: current live asks for the same combo as a sorted
     dot/strip plot with the subject listing highlighted, links to each
     comp. Deploy on `/whats-it-worth` results and combo pages.
4. **Ruthless chart triage.** Delete the 8 orphaned registry charts or
   wire the 3 useful ones (trait-freq-price, box plot, price histogram)
   into real pages; delete Sunburst and ForceGraph (decorative); fold
   BubbleChart and SellerLeaderboardScatter into one seller chart; fold
   DaysToSellHistogram and TimeOnMarketHistogram into one component with
   a comparison mode. Then delete the chart registry/prefs/presets system
   entirely (it manages toggles for ~4 charts on 2 pages; the settings
   drawer keeps only theme + data prefs). Less machinery, more chart
   quality.
5. **Dashboard de-duplication.** On `/market` Overview: one "is the market
   hot" headline (temperature), one index card, movers, done. Sub-indices
   move into the Combos tab strip. Every regional treatment consolidates
   on the choropleth + the combo-by-region table.

Acceptance: switching OS light/dark restyles every chart; resizing/rotating
re-renders correctly; a breeder on `/whats-it-worth` sees where their ask
sits in the live distribution and can click through to three comps; the
chart settings panel is gone and nobody misses it.

### Phase A: Alerts and retention (~3-4 sessions)

Goal: the product reaches out with value, which is what makes a data tool
sticky for breeders/sellers.

1. **One alert dialect.** Migrate WatchButton to emit matcher-compatible
   queries (`{trait_all:[...]}, {seller_ids:[...]}` etc.); write a
   translation for existing rows; the `from-url` endpoint becomes the
   single creation path ("Save this search as an alert" button on any
   filtered view, since the URL *is* the query).
2. **Channel management UI** on My Geck: add Discord webhook (exists in
   notify.ts), add email via Resend (the long-deferred dependency
   decision; free tier suffices at current scale; needs RESEND_API_KEY
   env + sign-off), verify with a test ping. Migration 0030 must be
   applied first (Phase R.5).
3. **Digest worker.** A scheduled route (Vercel cron) that batches unsent
   `alert_matches` into a daily email digest per user; immediate sends for
   price-drop matches. Ack/snooze/delete buttons on My Geck wired to the
   existing endpoints.
4. **Anonymous-to-known funnel.** Watch anything -> soft prompt to sign up
   with one-click magic link (Supabase supports it) so alerts have
   somewhere to go. This is the growth loop: shared price-estimate links
   in (from Phase U), alert emails bringing people back.

Acceptance: create "Lilly White under $400" from a filtered /sold URL in
two clicks, receive the digest email when a matching listing arrives, ack
it from the email link.

### Phase G: Grow the moat (ongoing after A)

Ordered ideas, each its own project; pick based on what the restored data
supports:

1. **Real sold prices.** The structural weakness vs. Card Ladder-style
   products. Attack from three sides: (a) auction closes (extension
   `auctionClose` events carry true final prices; prioritize reviving
   that), (b) "last ask before delisting within N days" as a labeled
   sold-proxy tier with its own confidence class, (c) voluntary seller
   reporting: a "report your sale" one-field form on listing pages for
   logged-in sellers (breeders have strong incentives to establish comps
   for their lines). Keep the tiers separate in schema
   (`price_kind: ask|observed|auction|reported|inferred`).
2. **Pricing engine v2.** Once sold/observed volume supports it: replace
   the univariate trait premiums + multiplicative multipliers with a
   simple hedonic regression (log-price on trait indicators + age + sex +
   proven + region + season), refreshed weekly into
   `price_adjustment_factors` (the plumbing already exists), with honest
   CIs replacing the ad-hoc confidence formulas. Keep the current system
   as fallback below sample thresholds.
3. **Seller toolkit ("my listings").** A seller claims their MorphMarket
   slug (verification: put a token in their MM bio, scrape it). Then:
   their live listings vs market median, days-on-market vs combo typical,
   reprice suggestions, and weekly "your market" digest. This is the
   feature sellers would pay for.
4. **Breeder planning.** The 0006 breeding schema (pairs/clutches/
   hatchlings) exists with zero UI. A pairing planner: pick two parents'
   traits -> possible offspring combos -> current median ask, days to
   sell, supply trend for each -> expected clutch value. No genetics
   engine needed initially (crested inheritance is messy anyway): market
   data per resulting combo is the value.
5. **Morph-classifier synergy with geck-inspect.** Use the classifier to
   verify/enrich listing traits from photos (the training pipeline and
   `model_invocations` infra exist). Trait data quality is the ceiling on
   every analytic; photos are the ground truth.
6. **Monthly public market report** (real snapshots from Phase U.6) as
   the shareable, SEO-facing artifact; the embed widget already exists.
   This is the top of the adoption funnel for a community that lives on
   Facebook groups and forums.
7. **Second species.** The schema already tags species; gargoyles and
   leachies have the same MorphMarket structure and an underserved
   audience. Only after crested is genuinely good.

### Explicitly not recommended

- No new charting library, no state library, no CSS framework change
  (respect DECISIONS.md).
- No paid features until alerts + seller toolkit prove retention.
- No scraping expansion (more sites, more species) while the single
  MorphMarket feed lacks budget guards and alerting.
- Do not "fix" thin sold data by loosening `soldInferred` confidence;
  label and tier instead.

---

## Part 4: Handoff prompts

These are written to be pasted into a fresh session of any capable coding
model with access to this repo, the Supabase MCP (project
`dhotmtgryuovkmsncdby`), the Vercel deployment, and the GitHub repo.
Run them in order; each assumes the previous phase landed.

### Standing preamble (prepend to every prompt)

```
You are working on tennysonmilesperhour/geck-data, the market-data tool
behind Geck Intellect (crested gecko market intelligence for breeders and
sellers). Before writing code, read CLAUDE.md, CONTEXT.md, ROADMAP.md,
DECISIONS.md, and ARCHITECTURE.md in the repo root.

Hard rules:
- Follow CLAUDE.md's workflow: small focused commits, tsc --noEmit clean
  before every push, git add specific files only, watch the Vercel deploy
  after pushing.
- The Supabase project is shared with two other consumers (the Eye in the
  Sky extension and the geck-inspect classifier app). Never change the
  semantics of existing columns on market_listings, morph_taxonomy, or
  listing_images. Additive changes first; coordinate deprecations.
- Crested-gecko-only on all public read paths.
- Schema changes: write the migration file AND apply it to prod via the
  Supabase MCP in the same session. Ask before any DDL that drops or
  rewrites existing data.
- Keep D3 as the only chart library. Do not add state-management or
  charting dependencies. Any new dependency (e.g. Resend) needs explicit
  sign-off in the conversation before installing.
- No em dashes anywhere: not in code, comments, markdown, or UI copy.
- Plain-English comments; the maintainer is a non-coder.
- Update DECISIONS.md with a dated entry describing what you did, what
  you deferred, and anything the next session must know.
- Verify honestly: run the relevant checks, exercise the changed flow,
  and report failures as failures.
```

### Prompt R (Resuscitate)

```
Phase R of ROADMAP.md: the data pipeline is dead and must never die
silently again.

Context: every Decodo request has returned HTTP 429 since 2026-06-09
(quota exhausted or subscription lapsed; check the dashboard/account
first and tell me what you find; I may need to renew or approve a
replacement provider before you proceed). The Eye in the Sky extension
has not POSTed to /api/ingest since 2026-05-14. Nothing alerted on
either. Also: prod schema has drifted from supabase/migrations (0028,
0030, 0031 never applied; RPCs mark_unseen_listings_inactive,
listings_needing_detail_scrape, listings_needing_image_download exist
only in prod, in no migration file).

Do, in order, with one commit each:
1. Add a fail-fast guard to scripts/scrape_listings.py, scrape_details.py,
   scrape_sellers.py: after 5 consecutive fully-failed page fetches, abort
   the run, write scrape_runs.status='failed' with the real error message.
2. Add a monthly request-budget guard to scripts/lib/decodo_client.py
   backed by the runtime_config table (key decodo_requests_this_month,
   reset monthly): hard-stop new requests past 90% of the 19k quota and
   record the stop reason in scrape_runs.
3. Add a failure-notification step to every scrape workflow in
   .github/workflows/ that POSTs a summary to a Discord webhook (env
   DISCORD_OPS_WEBHOOK; tell me to add the secret) on failure OR timeout.
4. Extend /api/status.json and the /status page to report per-scrape_type
   freshness from scrape_runs alongside the existing extension-stream
   checks. A scrape_type with no successful run in 36h reports "down".
5. Build a StaleDataBanner component: when max(market_listings.last_seen_at)
   is older than 48h, render a plain-language banner on every public page.
   Replace every DataFreshness updatedAt={Date.now()} call site
   (MarketIndexCard.tsx, sellers/page.tsx, sold/page.tsx) with real
   timestamps from the data.
6. Capture the three hand-created RPCs into a new migration file (read
   their definitions from prod via the Supabase MCP: select pg_get_functiondef),
   then reconcile: list repo migrations vs
   supabase_migrations.schema_migrations, apply 0028/0030/0031 to prod
   after showing me a summary of what each creates, and record the
   reconciliation in DECISIONS.md.
7. Delete .github/workflows/scrape-listings-daily.yml (fully redundant
   with the hourly workflow).
8. Add a nightly workflow that runs select public.refresh_combo_index_daily();
   and a weekly one that POSTs /api/training/refresh-adjustments.
Then: once I confirm the proxy is funded, trigger the weekly-resync
workflow manually, watch it complete, and report listings/price ticks
ingested plus how stale-status flipped on /status.
```

### Prompt T (Truth)

```
Phase T of ROADMAP.md: make every number real, labeled, and consistent.
Read Part 1 of ROADMAP.md for the verified bug list first.

Work items, one commit each unless noted:
1. Trait delimiter: scraper writes cached_traits pipe-delimited
   (scrape_listings.py:270) but the 0037 views split on commas. Normalize
   to comma+space at write time in the scraper AND canonical.py, run a
   one-time backfill on market_listings (show me the count first), then
   refresh combo_index_daily and report how many observed combos exist
   before vs after.
2. Tokenizer consolidation: make src/lib/traits.ts the single tokenizer;
   have combos.ts, alerts/matcher.ts, and market/trait-premium.ts consume
   it (preserve each caller's semantics with options, and keep the
   existing unit tests passing; extend them). Wire resolveSynonym from
   src/lib/market/synonyms.ts into the matchCombo path and the
   market.json trait cascade.
3. Combo vocabulary unification: migrate v_combo_price_distribution and
   v_recent_combo_sales off the hardcoded _combo_id_from_traits to the
   0037 observed-combo universe, keeping output shapes identical (the
   fair-price API and geck-inspect depend on them). Write the migration,
   apply via MCP, and verify /whats-it-worth and /indices now agree on
   the combo list.
4. Honesty pass: in src/lib/market/queries.ts remove the fabricated
   stddev (median*0.15), the breeder-score positional fallback
   (30 + idx%60), and fix Top Movers to compare disjoint windows. In
   data/market.json/route.ts stop imputing sold_price=ask: add
   last_ask_price, keep sold_price only when a real sold price exists,
   and bump the payload with additive fields only (check geck-inspect's
   consumer expectations in docs/geck-inspect-integration.md before
   changing anything it reads). Label ask/observed-derived numbers in the
   UI widget subtitles.
5. One region parser: create src/lib/market/regions.ts, port the best of
   the four existing implementations (combo page, trait page, region page,
   matcher), use it everywhere, unit-test it.
6. Species backfill: implement classification in src/lib/ingest/species.ts
   patterns against title/category for existing rows (all 9,674 rows are
   'unknown' today), run the backfill via MCP with a dry-run count first,
   make the scraper canonical mirror set species going forward.
7. Fix events.ts searchResultBatch to preserve terminal statuses like
   touch_listing_seen does. Unit-test.
8. Replace raw error.message rendering on sold, price-drops, sellers,
   shows, cross-platform, watchlist, alerts pages with a shared friendly
   error panel that logs details server-side.
9. Add tests: market.json contract (vocabulary mapping, combo cascade,
   sold semantics), trait-premium, regions, and a CI step comparing repo
   migration filenames to prod's applied list (fail on drift). Fix the
   api-docs freshness copy to match the actual s-maxage.
```

### Prompt U (UX consolidation)

```
Phase U of ROADMAP.md: collapse the sprawling IA into six destinations
and make every state shareable. Read Part 3 Phase U for the target nav.

1. Nav: reduce Header.tsx TABS to Pulse, Price a gecko, Market, Sold,
   Sellers, My Geck (auth). Merge /indices into /market as the top strip
   of the Combos tab; merge /trends as an "Over time" tab; fold
   /price-drops into /sold behind an ?event=drop filter chip (redirect
   the old routes). Merge /watchlist and /alerts into /my (redirects).
   Park /shows and /cross-platform (remove from nav; keep routes). Put
   /methodology, /api-docs, /status in a footer. Cross-link /admin and
   /data-admin for the operator. One commit per merge.
2. Make landing filters URL-driven: replace LandingFiltersProvider's
   context state with the canonical URL schema from src/lib/filters/
   so Pulse selections survive copy/paste.
3. Make /whats-it-worth shareable: encode traits/age/sex/price inputs in
   the query string, restore on load.
4. Pick ONE theme (recommend the ink palette with the market green as an
   accent token) and apply it to /market and /whats-it-worth; delete the
   market-theme fork. Screenshot before/after for me.
5. Add loading.tsx skeletons for market, sold, sellers, combo, trait,
   and my routes. Adopt the market EmptyState component on every chart
   and table, with three distinguishable causes: not enough data yet /
   pipeline stale since <date> / filters too narrow.
6. WatchButton: show "already watching" on mount, prevent duplicate rows.
7. Reports: create market_report_snapshots (migration), a monthly
   workflow that writes the snapshot, and make /reports list only real
   snapshot months.
8. First-run strip on Pulse: three sentences plus four buttons (What is
   this gecko worth / Is the market hot / Watch something / How are
   sellers doing), dismissible, localStorage.
Verify each flow on a phone-sized viewport before pushing; tell me which
flows you exercised.
```

### Prompt V (Visualization)

```
Phase V of ROADMAP.md: one chart system, three killer visualizations.
Read Part 1 "Data visualization state" and Part 3 Phase V first. Keep D3.

1. Theme: create src/lib/charts/theme.ts (CSS-variable backed, light and
   dark) with one categorical palette (extend the anchor-morph colors),
   one up/down semantic pair, and typography tokens. Port every chart in
   src/components/charts/, market widgets, and landing viz to it. Kill
   the hardcoded hex.
2. Interaction standard: extract the crosshair tooltip from
   market/charts/InlineCharts.tsx AreaChart into a shared hook/component;
   add a useChartSize hook (ResizeObserver) and adopt in every D3 chart;
   add an InsufficientData in-chart message and use it wherever charts
   currently render silent empty SVGs.
3. Chart triage, one commit each: delete Sunburst and ForceGraph; merge
   BubbleChart into SellerLeaderboardScatter (keep the density-grid
   rendering, one component); merge TimeOnMarketHistogram and
   DaysToSellHistogram into one component with an optional comparison
   series; wire PriceHistogram and TraitFrequencyAndPrice into the /sold
   and Market pages respectively; then DELETE the chart
   registry/prefs/presets system (src/lib/charts/{registry,prefs,presets},
   ChartGrid, ChartSettingsPanel) and mount the surviving charts
   directly. The settings drawer keeps only non-chart prefs.
4. Build PriceBandOverTime (median line, p25-p75 ribbon, sample-size
   fading, from/to brushing writing the canonical URL keys). Requires
   extending combo_index_daily with p25/p75 columns (migration + apply +
   refresh). Mount on /combo/[slug], /trait/[slug], and Market's Over
   time tab.
5. Build WhereDoesMineSit: density strip of current market prices for
   the selected combo/traits with a marker at the user's price and a
   percentile callout. Mount on /whats-it-worth (replacing PriceBar) and
   /listings/[id].
6. Build PriceLadder: sorted strip of live asks for the same combo,
   subject highlighted, each dot linking to the listing. Mount on
   /whats-it-worth results and /combo/[slug].
Screenshot every new/changed chart in both themes and share them.
```

### Prompt A (Alerts)

```
Phase A of ROADMAP.md: make alerts real end-to-end. Prerequisites:
migration 0030 applied (Phase R item 6) and Resend sign-off from me
(ask if not yet given; do the rest while waiting).

1. One dialect: rewrite WatchButton to emit matcher-compatible queries
   (trait_all / seller_ids / min_price / max_price / regions /
   must_be_drop). Write a data migration translating existing
   {kind,...}-shaped alert rows. Extend tests/alerts-matcher.test.ts to
   prove a seller watch matches only that seller and a trait watch only
   that trait.
2. "Save this search as an alert" button on /sold, /market, and /sellers
   filtered views, POSTing the current canonical URL to
   /api/alerts/from-url.
3. My Geck page: list alerts with pause/ack/snooze/delete wired to the
   existing endpoints; channel management (add Discord webhook or email,
   send a test ping); show recent matches inline.
4. Email: add Resend (after sign-off), implement the email branch in
   src/lib/alerts/notify.ts, plus a Vercel cron route that batches unsent
   alert_matches into one daily digest per user (immediate send for
   price-drop matches). Record every attempt in alert_delivery_attempts.
5. Sign-up nudge: anonymous users tapping Watch get a magic-link sign-in
   prompt inline (Supabase OTP), returning to the same page.
End-to-end verification before you report done: create a watch through
the UI, ingest a matching synthetic event through /api/ingest (test key),
and show me the delivered Discord/email payload.
```

### Prompt G (pick one growth project per session)

```
Phase G of ROADMAP.md. Pick exactly one of the following (confirm with me
first), read the relevant Part 3 Phase G item, and ship it end to end:
G1 sold-price truth tiers (price_kind schema + auction closes + delist
proxy + seller-reported sales form), G2 hedonic pricing v2 behind sample
thresholds, G3 seller toolkit with MorphMarket slug claiming, G4 breeder
pairing planner over the 0006 schema, G5 classifier-verified traits with
geck-inspect, G6 real monthly public report + embed. For whichever you
pick: spec it in DECISIONS.md first (schema, routes, UI, verification
plan), get my confirmation, then implement in small commits.
```

---

## Part 5: Success metrics

Track these on /admin/analytics (most are already instrumented via
user_events; the pipeline ones come from Phase R):

- Pipeline: hours since last successful scrape per type (target < 26h);
  scrape budget consumption vs quota; extension events/day.
- Truth: % of listings with parsed traits and non-unknown species
  (target > 90%); observed combos count; sold-tier volumes by price_kind.
- Usage: weekly active users; price estimates run/week; estimate links
  shared (URL visits with estimator params); watches created; alert
  emails delivered and clicked.
- Retention: 4-week return rate of users who created a watch (the
  hypothesis behind Phase A is that this cohort retains far better).

The first genuinely meaningful milestone for the product is not a feature.
It is: **30 consecutive days of uninterrupted data flow, and 10 real
breeders/sellers who each ran a price check and set a watch.** Everything
in this roadmap is sequenced to make that milestone reachable and then
compound on it.
