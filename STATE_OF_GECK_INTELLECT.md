# State of Geck Intellect

Phase 1 audit for the product rework toward "answers, not analytics."
Written 2026-07-16 from the repo, the production Supabase project, and
the GitHub Actions pipeline. Every number in here was queried live
against production today, not inferred from code or older docs.

Companion reading: `ROADMAP.md` (the 2026-07-07 audit, still largely
accurate and cross-referenced below), `ARCHITECTURE.md` (code
inventory), `DECISIONS.md` (decision log).

---

## TL;DR verdict

1. **The thesis is right and the codebase is closer to it than the
   handoff assumes.** `/whats-it-worth` plus `/api/market/fair-price`
   is already a real valuation engine skeleton: trait picker,
   percentile bands, multiplicative adjustments for age/sex/weight/
   proven, recent comps with links, honest confidence tiers. It is
   buried as one of 12 nav tabs instead of being the front door.
2. **The blocker is not product, it is data.** The scrape feed has
   been dead since 2026-06-09 (Decodo returns 429 on every request,
   still failing as of this morning). The extension feed has been
   silent since 2026-05-14. Effective date coverage is ONE MONTH
   (2026-05-09 to 2026-06-09), now five weeks stale. No feature work
   changes the product's credibility until data flows again.
3. **International arbitrage has zero supporting data today.** The
   dataset is 97.8% USD, 2.2% CAD, nothing else. The R1 analysis
   below shows the top 10 combos have no non-US rows at all. The
   feature is not dead, but v1 of it must begin with data
   acquisition (scraping MorphMarket's UK/EU regions), not UI.
4. **Exact-combo valuation cannot work with this dataset; trait-
   similarity comps can.** 1,215 distinct sold trait-combos exist but
   only 28 have 5+ sales. Individual traits have real depth
   (Harlequin 233 sold, Lilly White 160, Pinstripe 127). The engine
   must match on trait overlap plus adjustments, which is the
   direction the existing `f_price_band_for_traits` RPC already
   points.
5. This repo already contains a rigorous audit and phased plan
   (`ROADMAP.md`, nine days old) whose diagnosis matches the new
   handoff almost exactly ("the product surface is 80% built, but the
   data underneath it is dead, thin, and in places dishonest").
   Phase R of that plan (pipeline resuscitation) is partially
   executed. The rework should merge the two plans, not restart.

---

## 1. Repo and deployment map (condensed)

Full inventory lives in `ARCHITECTURE.md`; this is the audit-relevant
summary.

- **App**: Next.js 14 App Router, TypeScript, Tailwind, D3. ~30
  routes. Deployed to Vercel from `main` (direct-push workflow),
  live at `geck-data.vercel.app` (spec name:
  `geckintellect.geckinspect.com`).
- **Pipeline**: Python scrapers in `scripts/` (MorphMarket via
  Decodo), scheduled by GitHub Actions. Hourly listings scrape
  PAUSED 2026-07-15 (schedule commented out after a 429 storm);
  weekly resync/details/images/sellers crons still enabled but
  failing at the Decodo layer. Discord failure alerts and a monthly
  budget circuit-breaker (`scripts/lib/budget.py`) were added in
  Phase R (commits #116-#119).
- **Database**: Supabase Postgres, 38 migrations, ~43 tables. Two
  parallel listing stores: `listings` (scraper-side raw) and
  `market_listings` (canonical, extension-convention), bridged by
  `scripts/lib/canonical.py`.
- **Consumers of this data**: this site, the Geck Inspect classifier
  app (via `/data/market.json`, which is a live route, not a file),
  and the Eye in the Sky extension (writes via `/api/ingest`).
- **Auth**: Supabase email/password. No billing, no tiers, no paywall
  anywhere in this repo. Login gates watchlist/alerts/upload/admin
  only.

## 2. Honest dataset assessment (queried 2026-07-16)

| Measure | Value | Note |
|---|---|---|
| `listings` rows | 9,355 | 6,942 flagged active (stale; nothing verified in 5 weeks) |
| `market_listings` rows | 9,674 | ALL `species='unknown'`; classifier never ran |
| Date coverage | 2026-05-09 to 2026-06-09 | one month, then flatline |
| `price_history` ticks | 44,938 | earliest 2026-04-22, frozen since 06-09 |
| Sold listings (scraper `sold_at`) | 2,849 | inferred from availability flips between scrapes |
| Sold with price and traits | 1,677 | the entire usable comps pool |
| `listing_status_events` sold | 92 | the extension-side "sold" stream, effectively empty |
| Distinct sellers | 756 | |
| Currency mix | 9,152 USD / 202 CAD / 1 null | no GBP, EUR, JPY, KRW at all |
| `seller_location` on canonical rows | ~90% blank | populated rows are all US cities |
| Trait coverage | 5,831 of 9,355 listings (62%) | `market_listings.norm_traits`: only 642 rows (7%) |
| Lineage data | 0 rows | drop lineage from v1 valuation inputs |
| Weight data | 5,008 listings | good; weight adjustment is viable |
| Median ask (USD) | $281 | sanity-checks against the published ~$350 market average (asks skew below blended sold/ask) |
| Lilly White median sold | $350 (n=160) | inside the published $250-1200 band |

**Can it support a credible valuation engine today?** Yes, narrowly,
with honest labeling. 1,677 sold-with-traits comps over one month is
enough for trait-similarity comps on the ~30 highest-volume traits
with real confidence tiers ("8 comps, high confidence" vs "3 comps,
low confidence" per the handoff's own bar). It is NOT enough for:
exact-combo pricing (28 combos have 5+ sales), seasonal trends,
year-over-year anything, or regional spreads.

**Biggest data-quality risk**: sold prices are last-observed asks at
the moment a listing flipped to sold, not negotiated prices, and the
one-month window means every trend number rests on a single market
regime. Second-biggest: trait vocabulary contamination. The trait
stream includes pseudo-traits ("Diet: Meal Replacement", "Proven
breeder: No") that leak into combos and premiums, plus the known
pipe-vs-comma delimiter bug (ROADMAP bug #1) that collapses scraper
traits into one token on the canonical side, plus four divergent
tokenizers and unwired synonym resolution. Fixing the vocabulary is a
prerequisite for a valuation engine anyone trusts.

**Note on the historical archive**: the handoff cites ~5,800 listings
"historically," and BRIEF.md describes CSVs at `~/Desktop/geckscrape/`
(≈6,003 summary rows, ≈5,849 detailed) that predate this database.
Production's earliest timestamps are 2026-05-09, which suggests those
rows were either imported with import-date timestamps or never
imported. If the CSVs retain original scrape dates, loading them
properly could multiply our date coverage. Question 2 below.

## 3. The five questions vs. what exists

| # | Question | Current answer surface | State |
|---|---|---|---|
| 1 | What is this gecko worth? | `/whats-it-worth` + fair-price API | **Real but buried.** Trait mode works via `f_price_band_for_traits`; combo mode still hardcodes 12 combos; estimates are not URL-shareable; no MorphMarket-URL input |
| 2 | Is this listing over/under-priced? | Pieces: `/listings/[id]`, OpportunitiesPanel, price-drops | **Fragmented.** No paste-a-URL deal check. The URL parser already exists in `/api/alerts/from-url`; it needs to feed the valuation flow instead |
| 3 | What's trending up/down? | `/indices`, `/trends`, `/market` tabs, `/reports` | **Overbuilt and undertrusted.** Three overlapping surfaces on one month of data; movers math has a known bias bug; reports render synthesized months |
| 4 | What pairing gets higher-value offspring? | `v_combo_profitability`, ProfitabilityTiers, `breeding_pairs` (empty) | **Thinnest.** No offspring-outcome data exists; anything shipped here would be genetics heuristics, not market data |
| 5 | Where is this morph cheap/expensive? | Regional tab, `/region/[code]`, arbitrage tab | **No data.** US-only dataset; regional pages parse blank location strings with three different regex parsers |

### Cut / keep / demote

**Keep and promote (serves the five questions):**
- `/whats-it-worth` becomes the homepage hero. It is the product.
- `/sold` comps browser (feeds trust in the valuation).
- `/listings/[id]` upgraded into the deal-check result page.
- `/sellers` and `/sellers/[id]` (breeders check sellers constantly).
- `/methodology`, `/status` (credibility infrastructure).
- One trends surface (see demote).

**Demote or merge:**
- `/market`, `/indices`, `/trends` collapse into ONE market-direction
  page (ROADMAP Phase U already specifies this; it maps to question 3).
- `/compare` becomes a mode on combo/seller pages, not a nav tab.
- `/price-drops` becomes a filter chip on `/sold` or a deal-feed
  module, not a destination.
- `/reports` stays but only with real snapshot-backed months, rebuilt
  as the public marketing artifact (see section 6).

**Cut (or park until their feeds exist):**
- `/shows`, `/cross-platform`, `/daily-log` (empty or ops-only).
- Decorative charts: Sunburst, ForceGraph, RidgePlot; the 8
  unreachable registry charts; the chart-prefs/presets system and its
  settings drawer.
- Breeding ROI as a v1 pillar (question 4). Revisit when there is any
  outcome data; a static "trait market-value tier" table is the
  honest v1 stand-in.
- Landing scrollytelling and the multiple "is the market hot"
  widgets (keep exactly one temperature readout).

## 4. R1: Regional price spread from existing data

Method: top 10 trait-combos by listing volume, median asking price by
currency (currency is the only reliable region signal; seller_location
is ~90% blank).

| Combo | Region/currency | n | Median |
|---|---|---|---|
| Harlequin | US | 88 | $150 |
| Lilly White | US | 81 | $300 |
| Tri-color | US | 61 | $300 |
| Cappuccino + Lilly White | US | 59 | $400 |
| Extreme Harlequin | US | 59 | $300 |
| Cappuccino | US | 48 | $300 |
| Dalmatian | US | 41 | $150 |
| "Diet: Meal Replacement" (pseudo-trait) | US | 41 | $250 |
| Extreme Harl + Cream + Dark (+diet token) | US | 35 | $500 |
| Extreme Harl + Yellow + Dark (+diet token) | US | 34 | $556 |

**Zero non-USD rows appear in any top-10 combo.** The 202 CAD listings
are spread too thin to form a single per-combo median of n>=5. Two of
the "top combos" are diet/metadata contamination, which independently
confirms the vocabulary cleanup priority.

**Verdict: the arbitrage feature is not validated and cannot be with
data on hand.** This kills arbitrage as a near-term UI feature but not
as a strategy: MorphMarket runs regional sites (UK/EU) that the same
Decodo pipeline can walk, and the schema already carries currency,
`price_usd_equivalent`, and `usd_rate_used` columns. The honest
sequencing is: (a) restore the US feed, (b) add a UK/EU grid scrape
and measure volume for a few weeks, (c) build the arbitrage view only
once two regions have per-combo n>=5 depth. Korea/Japan (Cretti etc.)
are separate scrapers and belong to a later phase. R2 (the
legal/shipping friction brief) is deferred until we decide arbitrage
is go; happy to run it as a research task on request.

## 5. R3: Freshness audit and re-scrape cadence

- Newest scraped data: 2026-06-09, 37 days stale today.
- Every scrape attempt since then fails at Decodo with 429 on the
  first request. The hourly workflow schedule was commented out
  2026-07-15; weekly resync/details/sellers crons still fire and
  fail (each failure pings Discord and burns nothing further thanks
  to the 5-consecutive-failures abort).
- Root cause is outside the repo: the $19/mo Decodo plan's 19,000
  request quota is exhausted or the subscription/credentials lapsed.
  Only you can verify this on the Decodo dashboard. This is the
  single highest-leverage action available (question 1 below).

Proposed sustainable cadence within the 19k/month budget, once the
account works (rough request math, one request = one page):

| Job | Cadence | Est. requests/month |
|---|---|---|
| Listings delta walk (~8 pages/run) | every 4h instead of hourly | ~1,450 |
| Full grid resync (~264 pages) | weekly | ~1,150 |
| Detail re-scrape | weekly, capped 200 | ~800 |
| Seller pages | weekly | ~2,800 |
| **Total** | | **~6,200 (33% of quota)** |

That leaves ~12k/month headroom, enough to add a UK/EU listings walk
(similar page counts to the US grid) while staying under the existing
90% budget circuit-breaker. Freshness product bar: every public page
shows real data age (Phase R already replaced the fake "updated just
now" stamps), and anything older than 48h gets the stale banner.

## 6. The marketing flywheel: current state

`/reports/[month]` exists but synthesizes all 12 months from today's
data (the footer admits it). To make the flywheel real: a
`market_report_snapshots` table written by a monthly (or weekly)
GitHub Action, report pages render only months with a snapshot row,
plus an OG-image endpoint for the shareable card. Email requires the
Resend decision (no email infra exists). This is cheap once the data
layer is alive and is the right SEO/authority play; ROADMAP Phase U
item 6 already specifies the snapshot mechanics.

## 7. R4: Gecko-specific vs market-agnostic seams (summary)

Full detail to be folded into `ARCHITECTURE.md` during the doc
rewrite. The short version: the scrape/ingest skeleton
(`scrape_runs`, UPSERT flows, Decodo client, budget guard,
`runtime_config`, canonical mapping, species routing) is already
market-agnostic; migration 0010 deliberately keeps non-crested rows
with a species tag. The gecko-specific surface is thin and enumerable:
the hardcoded grid URL in `scrape_listings.py`, the
`species IN ('crested','unknown')` read filters,
`HIGH_VALUE_COMBOS`/anchor colors/trait tiers/weight buckets in
`src/lib/market/`, and the taxonomy seed tables. Duplication into a
second market is mostly config extraction, not rearchitecture. Do not
abstract any of it yet.

## 8. Valuation engine recommendation (preview of Phase 2)

Given the measured comps depth, the engine should be **comparable-
matching first, explainable always**:

1. Normalize the input trait set (one tokenizer, synonyms wired,
   pseudo-traits stripped).
2. Pull sold comps scored by trait-set similarity (exact superset >
   exact match > high Jaccard overlap), 180-day lookback, recency
   weighted.
3. Apply the existing multiplicative adjustments (age, sex, weight,
   proven) from `price_adjustment_factors`.
4. Output a p25-p75 range, midpoint, confidence tier from comp count
   and dispersion, and the actual 5-10 comps with links. If comps < 3,
   say "not enough data," never extrapolate.

A hedonic regression adds nothing at n=1,677 except opacity; revisit
after six months of flowing data. The "paste a MorphMarket URL" input
reuses the `/api/alerts/from-url` parser plus a single-listing detail
scrape (1 Decodo credit per check, well within budget, cacheable).

## 9. How this merges with ROADMAP.md

ROADMAP's phases R (resuscitate) and T (truth) are prerequisites for
everything in the new handoff and carry over unchanged; R is partially
done, T not started. Where the plans differ is emphasis, and the new
handoff wins: Phase U's IA consolidation gets re-centered on the
valuation hero flow instead of a general nav cleanup, the reports
system is rebuilt as the public marketing flywheel, and arbitrage
enters as a data-acquisition track rather than a UI feature. The
detailed merged build plan is the Phase 2 deliverable, pending answers
below.

---

## Questions for Tennyson

Each has a recommendation so you can answer with "yes" or a one-liner.

1. **Decodo account (blocking everything).** Log into the Decodo
   dashboard: is the subscription active, and is the monthly quota
   exhausted? Recommend: renew/upgrade if lapsed; if it looks fine,
   the auth secret has drifted and I'll debug from the pipeline side.
   Also confirm the budget: staying at $19/mo shapes the cadence
   table in section 5.
2. **Historical CSVs.** Do `~/Desktop/geckscrape/crested_geckos_full.csv`
   (and the JSONL) still exist, and do the rows carry original scrape
   dates from before May 2026? If yes, I'd like them imported with
   real dates to extend trend coverage. Recommend: yes, one-time
   import script.
3. **UK/EU scrape.** Approve adding a MorphMarket UK/EU listings walk
   (~1-2k Decodo requests/month) as the data-acquisition first step
   for arbitrage? Recommend yes, after the US feed is verified stable
   for two weeks.
4. **Eye in the Sky.** The extension has been silent since 2026-05-14.
   Revive it (diagnose in its repo) or retire the streams that depend
   on it (sold events, auctions, cross-platform, views/favorites)?
   Recommend: brief diagnosis first; retire visibly if it takes more
   than a session.
5. **Sold-price semantics.** Confirm you're comfortable with "sold
   price = last asking price observed before the listing flipped to
   sold," labeled as such in the UI and methodology. It's the same
   convention MorphMarket itself reports. There is no way to observe
   negotiated prices. Recommend yes.
6. **Tiers and gating.** Free/Keeper/Breeder tiers live in Geck
   Inspect today; this repo has no billing or tier awareness. For
   premium features (arbitrage view, alerts), do we read entitlements
   from Geck Inspect's user system, or keep Geck Intellect fully free
   until the valuation flow proves retention? Recommend: fully free
   v1, wire tiers when there's something worth gating.
7. **Report cadence and email.** Weekly or monthly market report, and
   do you want email delivery (adds Resend as a dependency, free tier
   fine) or page + shareable image only for v1? Recommend: monthly,
   page + image first, email in the following phase. Can the ~88 Geck
   Inspect users legally receive it (did they opt into marketing)?
8. **Domain.** Is `geckintellect.geckinspect.com` actually configured
   in Vercel, or is `geck-data.vercel.app` still the only URL? Both
   403 to headless fetchers, so I can't tell from here.
9. **Branch process for this rework.** CLAUDE.md says direct-to-main,
   but this session is locked to a feature branch
   (`claude/product-rework-marketability-jlfkl9`). Fine to keep the
   audit/plan docs on the branch and merge via PR, then return to
   direct-to-main for build phases?
