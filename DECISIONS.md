# Decisions

Running log of architectural choices. One entry per phase (or
sub-phase), reverse chronological. Each entry: what was decided,
why, what was rejected, what changed from the plan, what was
deferred.

---

## 2026-07-07: Phase R (Resuscitate) from ROADMAP.md

Context: the July 2026 audit (see ROADMAP.md Part 1) found the scrape
pipeline dead since June 9 (Decodo 429 on every request, hourly jobs
burning their 15-minute timeout with scrape_runs rows stuck on
'running'), the extension stream silent since May 14, and nothing
alerting on either. This pass makes the pipeline fail fast, fail loud,
and tell users the truth about data age. All work on branch
`claude/gecko-tool-roadmap-8bb655`.

### Shipped

- **Scraper fail-fast**: 5 consecutive hard fetch failures abort the
  run as `failed` with the real error (scrape_listings walks, and the
  worker pools in scrape_details/scrape_sellers, which also cancel
  queued futures).
- **Decodo budget guard** (`scripts/lib/budget.py`): every API attempt
  counts against a `decodo_requests_YYYYMM` key in runtime_config;
  new requests hard-stop at 90% of the 19k monthly quota. Overrides:
  DECODO_MONTHLY_QUOTA, DECODO_BUDGET_STOP_FRACTION. Count is
  best-effort (concurrent runs can undercount slightly); Decodo's
  dashboard stays the billing source of truth.
- **Discord ops alerts**: composite action
  `.github/actions/notify-failure` posts to DISCORD_OPS_WEBHOOK on
  failure/timeout; wired into every scrape workflow plus
  apply-migrations. NEEDS THE SECRET: add DISCORD_OPS_WEBHOOK in repo
  settings or the step logs a note and does nothing.
- **Scheduled refreshes**: refresh-indices-nightly.yml calls
  `refresh_combo_index_daily()` (the materialised view had NO refresh
  schedule at all); refresh-adjustments-weekly.yml POSTs
  /api/training/refresh-adjustments (NEEDS the INGEST_API_KEY secret in
  GitHub Actions).
- **Deleted scrape-listings-daily.yml**: byte-for-byte redundant with
  the hourly delta walk. trigger-scrape allowlist updated to the
  workflows that exist.
- **Status watches the scrapers**: /api/status.json + /status now
  report per-scrape_type freshness from scrape_runs via
  `src/lib/status/scrapers.ts` (healthy run = delivered rows or had
  nothing to do). Overall status semantics changed: down = no data
  inflow 48h; degraded = any single stream unhealthy. The June failure
  mode can no longer report ok.
- **StaleDataBanner** on every page once data is older than 48h, and
  the five `DataFreshness updatedAt={Date.now()}` call sites now stamp
  the age of the data itself (/sold, /price-drops, /sellers, /trends,
  MarketIndexCard).
- **tsconfig**: dropped deprecated `baseUrl` (newer tsc makes it a
  hard error; paths already relative).

### Prod schema reconciliation (applied via Supabase MCP this session)

- `0038_capture_scraper_rpcs`: the three scraper RPCs
  (mark_unseen_listings_inactive, listings_needing_detail_scrape,
  listings_needing_image_download) existed only in prod since PR #48;
  definitions read back via pg_get_functiondef and captured as a repo
  migration, applied as a no-op.
- `0030_notification_channels_and_demand` and `0031_batch_jobs` were in
  the repo but never applied to prod (user_notification_channels,
  listing_views, listing_favorites, v_demand_index, batch_jobs now
  exist). Alert delivery has a schema to write to for the first time.
- Repo `0032_data_quality_and_alerts.sql` had only partially reached
  prod (as `0032_data_quality_columns`): alert_delivery_attempts,
  alert_matches.acknowledged_at/snoozed_until, model_invocations
  confidence columns, morph_human_labels, v_trait_recognition_metrics
  and prune_ingest_audit were missing. Re-applied in full as
  `0032_data_quality_and_alerts_full` (file is idempotent).
- `0028_backfill_drops_and_traits` applied WITH AN AMENDMENT: dry run
  showed 2,548 of 2,555 lag-derived drop candidates were near-dupes of
  extension-recorded drops (same listing within an hour, different
  timestamp), so the insert gained a 1-hour-window NOT EXISTS guard.
  Result: 7 genuinely missed drops inserted, 56 trait rows sanitized.
  Originals snapshotted in `_backup_0028_trait_rows`; drop that table
  once /trends and /market look right.

### Still blocked on Tennyson

1. **Decodo account**: renew/upgrade the plan (or approve a provider
   swap). Every request has 429'd since June 9; nothing scrapes until
   this is fixed. Then run the weekly-resync workflow manually once to
   re-baseline active/inactive statuses.
2. **DISCORD_OPS_WEBHOOK secret** in GitHub repo settings (a Discord
   channel webhook URL) to turn on failure alerts.
3. **INGEST_API_KEY secret** in GitHub Actions (same value as the
   Vercel env var) so refresh-adjustments-weekly can authenticate.
4. **Extension**: diagnose why Eye in the Sky stopped POSTing on
   May 14 (key, host, or layout change; check the eyeinthesky repo).

### Deferred to Phase T

The trait delimiter bug (scraper writes pipe-delimited cached_traits,
0037 views split on commas) is NOT fixed in this pass; note that
0028's sanitize keeps the pipe convention, so the Phase T
normalisation should convert delimiters and re-run the 0037 views in
one move.

## 2026-05-22: Phases 1-4 implementation pass

Tennyson approved Phase 0 and asked to ship the rest of the plan
end to end. Adopted my recommended answer for every open question
in the audit. Worked direct to `main` per `CLAUDE.md`; each phase
landed as one or more focused commits. Type-checked clean before
every push; existing 62-test suite kept passing throughout.

### Phase 1: canonical filter state + entity pages - shipped

Commits: `filters: canonical URL-state schema + hook + link helper`,
`entity pages: /combo/[slug], /trait/[slug], /region/[code]`,
`combos: wire entity-page links into Pulse, Combos table, Top Movers`.

- New `src/lib/filters/{schema,hook,link}.ts`. One canonical
  query-string schema (14 keys: `tf`, `region`, `age`, `lineage`,
  `sex`, `combos`, `traits`, `sellers`, `priceMin`, `priceMax`,
  `from`, `to`, `sources`, `sort`). Permissive parser; default
  values are not serialised so clean URLs stay clean. 17 new tests.
- `parseFilters(searchParams)` for server components,
  `useCanonicalFilters()` for client, `serverHref()` /
  `withFilters()` for preserve-everything-else links.
- New routes: `/combo/[slug]`, `/trait/[slug]`, `/region/[code]`.
  Server components reusing `Panel`, `KpiCard`, `DataTable`,
  `MiniSparkline`, `WatchButton`. No new chart code.
- Combo names in `WhatsHotPanel`, `RankedCombosTable`, and
  `TopMoversPanel` now linkify to `/combo/[slug]` when canonical.
  Used `stopPropagation` to keep existing in-tab drill-in
  callbacks working alongside same-tab navigation.
- New helper `comboFromName(name)` in `src/lib/market/combos.ts`.

Acceptance check: from Pulse, clicking a combo chip lands on the
combo page; "see top sellers" link on the combo page now passes
`?combos=<id>` to `/sellers`, which narrows the seller directory
to sellers carrying that combo's traits. Click a seller, land on
their detail page (combo filter is in the URL, ready for future
per-seller narrowing).

### Phase 2: indices, sub-indices, methodology - shipped

Commits: `phase 2: indices, sub-indices, methodology`.

- Migration `0035_market_indices.sql`. Lands the previously-stubbed
  `v_market_sub_index` (the four-up anchor morph tile on `/market`
  had been rendering empty since `fetchMarketSubIndices` returned
  the "not implemented" state). Also adds:
  - `v_market_sub_index_weekly` (view): per-anchor weekly median.
  - `v_market_sub_index(window_days)` (RPC): rebased to 1000 at
    window start.
  - `combo_index_daily` (materialised view): per-combo daily
    median + sample size, 365-day window.
  - `refresh_combo_index_daily()`: refresh helper for scheduled
    invocation (nightly).
  - `v_combo_index_summary`: latest value + 7/30/90d deltas per
    combo. Backs `/indices`.
- Apply this migration manually on prod via the Supabase MCP or
  the `apply-migrations.yml` workflow.
- New route `/indices`. Anchor sub-index tiles (linking to the
  per-trait page) + per-combo table with current value, 7/30/90d
  deltas, 90-day sparkline (links to `/combo/[id]`). Empty-state
  copy points the operator at the migration / refresh helper.
- New route `/methodology`. Plain-language definitions for every
  derived metric (median ask, KDE ridge, days to sell, arbitrage,
  market index, sub-indices, combo indices, confidence, source
  attribution, adjustments) plus an explicit "limits" panel.
  Section ids so other pages can deep-link.
- `MarketSubIndices` tiles linkify to `/trait/[slug]`; existing
  `onSelectCombo` in-tab callback preserved for same-tab nav.
- Header: added `Indices` to the analysis tab group.

Acceptance check: open `/indices`, see the four anchors with
sparklines and deltas; click any anchor to land on `/trait/...`;
click any combo row to land on `/combo/...`. Methodology is one
click away from the header.

### Phase 3: cross-filter substrate + Market URL state - shipped

Commit: `phase 3: /market filter state moves to canonical URL schema`.

- `MarketDashboard` now reads `filters`, `tab`, and `selectedCombo`
  from the URL via `useCanonicalFilters` + `useSearchParams`. Every
  mutation re-writes the URL through `router.replace` with scroll
  preserved.
- Bridge functions `toMarketFilters` / `withMarketFilters` translate
  between the canonical schema and the existing `MarketFilters`
  shape used by every widget, so no widget needed editing.
- Back / forward / refresh / share all preserve the dashboard
  state. `?tab=combos&combo=...` is a shareable deep-link.

This is the substrate the spec calls for: any chart on `/market`
that calls `setFilters({ traits: [...] })` updates the URL, which
re-renders every panel against the new filters in a single React
transition.

**Deferred from Phase 3**:

- Per-widget click handlers that write `traits: [...]` into the
  URL on chart-element click (the trait ridge, the regional map,
  the velocity histogram). The substrate is shipped; each widget's
  onClick wiring is a follow-up commit per widget and was not
  bundled into this pass.
- Time-range brushing component (drag a date range on any chart,
  every other time series on the page snaps to it). The canonical
  schema has `from` / `to` keys; the UI control is deferred.
- Compare page rebuild to any-two-entities. Not yet shipped; the
  existing trait-premium + maturity bands + seller h2h view still
  stands.

### Phase 4: watchlist, API docs, CSV export - shipped (partial)

Commits: `phase 4: /watchlist, /api-docs, CSV downloads, header
watchlist link`, `phase 4: /sellers narrows by combos URL param`.

- New route `/watchlist`. Entity-oriented index of the authed
  user's saved alerts, grouped by `query.kind` (combo / morph /
  seller / region). Re-uses the existing `alerts` table (each
  alert IS a watch); no new schema. `/alerts` continues to show
  the matches inbox; the two are views over the same source of
  truth. Unauth visitors get an in-page sign-in prompt with
  `?next=/watchlist`.
- New route `/api-docs`. Documents every public read-only endpoint
  under `/api/market/*` and `/data/market.json`. Contract
  guarantees, per-endpoint param tables, clickable example URLs.
  Internal / auth-gated endpoints listed but explicitly out of
  scope.
- `CsvDownloadButton` component. Zero-dep, RFC 4180 escaping,
  generic over `Record<string, unknown>`. Wired into the `/sold`
  table; can be dropped onto any view that holds a row array.
- `/sellers` now respects `?combos=<id>` (a partial filter when
  the slug is unknown is silently skipped rather than failing
  the whole page). The combo entity page's "top sellers" panel
  link now actually narrows.
- Header: `Watchlist` and `Alerts` grouped after the analysis
  tabs, visible only when authed.

**Deferred from Phase 4**:

- Email delivery for alerts. `user_notification_channels` and
  `alert_delivery_attempts` exist on the schema; `notify.ts`
  exists in the lib. Adding Resend (recommended in the audit) is
  a new dependency decision that requires a key, an env var, and
  a sign-off. Discord / webhook channels remain operational.
- Per-view CSV button on every chart and table. The component is
  in place; only `/sold` was wired in this pass. Followups can
  add it to `/sellers`, `/combo/[slug]`, `/indices`, etc.
- Source attribution badges on every page. The `SourceBadgeList`
  component exists; today it's used only on `/market`. Followups
  can drop it on `/sold`, `/sellers`, `/trends`, `/indices`.
- Per-row sample-size confidence pip on every derived number.
  Components exist; rollout is per-call-site.
- Monthly report scaffolding at `/reports/[month]`. Not started.
- Per-combo cross-filter handlers on the trait ridge / geo /
  velocity widgets. Substrate ready (see Phase 3 deferred).
- Sparkline column on `RankedCombosTable`. Backed by
  `combo_index_daily` if migration 0035 is applied; the wiring
  was not bundled into this pass.

### Follow-up pass (2026-05-22 PM): substrate pivot + sparkline column + trait click-through

After applying 0035 the audit query showed only 92 sold events total
over 180 days, 4 anchor week-buckets, 3 combos with daily data, and
zero candidates for a sold-inference backfill (every listing has
been seen in the last 14 days). The sold-events stream is thin
because most listings have not actually flipped to sold yet, not
because the inference rule is failing.

Pivoted the index substrate from sold events to
`price_history` observations. The price_history table holds ~17K
ticks over 7585 distinct listings in the last 180 days, with
~135-226 listings per anchor. The indices' definition changes from
"median sold price" to "median observed market price"; this is the
same trade-off Zillow ZHVI makes (smoothed over all observed
prices, not only closed deals). Methodology page updated to reflect
this in the same push.

Migration `0036_indices_use_price_history.sql` applied to prod
(same session, via Supabase MCP). Post-pivot smoke test:
  v_market_sub_index_weekly  -> 8 rows, 2 weeks per anchor (was 4 rows, 1 week)
  v_market_sub_index(365)    -> 8 rows
  combo_index_daily          -> 8 rows, 4 distinct combos (was 5 / 3)
  v_combo_index_summary      -> 4 rows
  combos with 7d delta       -> 4 (was 0)

Anchor tiles on `/market` and `/indices` will now render real data
(the `series.length >= 2` gate in `fetchMarketSubIndices` is met).

Same push also lands two visible Phase 2/3 finishing touches:

- **Sparkline column on `RankedCombosTable`**. `fetchCombosRanked`
  now fetches `combo_index_daily` slices (last 60 days) and attaches
  a `spark: number[]` to each row. The table renders a `MiniSparkline`
  in the new `60d` column. Non-fatal on fetch failure; rows just
  render without sparklines.
- **Trait click-through on `TraitFrequencyAndPrice`**. The trait
  ridge on Pulse (and anywhere else the chart is mounted via
  `ChartGrid`) is now click-actionable: clicking any bar navigates
  to `/trait/[slug]` by default. Hover state added so the
  affordance is visible. Callers can pass `onTraitClick` to override
  the default navigation (e.g. write `traits` to URL filters on
  `/market` for in-page cross-filtering).

This brings Phase 3's headline acceptance ("clicking a trait
narrows the page") into a reachable place: the chart now emits the
event; widget-level wiring to consume it is per-chart polish.

### Operational notes for the next session

- **Migration 0035 has been applied to prod** (2026-05-22, via the
  Supabase MCP `apply_migration` tool as `0035_market_indices`).
  The file was renamed from `0034_market_indices.sql` to
  `0035_market_indices.sql` to avoid a prefix collision with the
  pre-existing `0034_trait_vocabulary_and_price_band` migration
  that landed earlier in the day. The new views and the
  materialised view all return real rows; the sample is sparse
  (~5 combo-day rows, one week per anchor) because the
  sold-events stream itself is thin. Anchor tiles will stay
  empty-state until at least two weeks of sold events accumulate
  per anchor (the fetcher in `src/lib/market/queries.ts` rejects
  single-week anchors as uninformative). Refresh
  `combo_index_daily` nightly via
  `select public.refresh_combo_index_daily();` from the Supabase
  SQL editor or a scheduled GH Action; the function is
  SECURITY DEFINER so it runs with sufficient privileges.
- The Vercel production deploy at `geck-data.vercel.app` (custom
  domain `geckintellect.geckinspect.com`) updates on every push to
  main; the audit branch `claude/market-analytics-visualization-zHvqT`
  has been merged via squash as PR #112 and is no longer in use.
- `tsconfig.json:17` still emits the deprecated-`baseUrl` warning
  (harmless; exit 0). Drop it whenever convenient.

---

## 2026-05-22: Phase 0 audit and proposed architecture for Phase 1+

### Status

Audit complete on branch `claude/market-analytics-visualization-zHvqT`.
No code has been written. Gated on Tennyson's approval of the open
questions below before Phase 1 starts.

See companion files: `CONTEXT.md` (what this project is),
`INTENT.md` (where it is going), `ARCHITECTURE.md` (what the code
looks like today, with the gap list).

### Reconciliation: codebase vs spec

The spec assumes the site is at "Level 1" with placeholders. The
audit shows it is further along than that. Things the spec asks for
that **already exist**:

- 10 of the 11 named routes (everything except the new entity pages).
- Per-listing entity pages (`/listings/[id]`), per-seller pages
  (`/sellers/[id]`).
- `MarketIndexCard` and `MarketSubIndices` UI components, hero
  + 4-up small-multiples idiom already built.
- `MiniSparkline` (pure SVG, slope-tinted) used on `/sellers`,
  `/listings/[id]`, and `/trends`.
- Source attribution (`SourceBadge`) and confidence
  (`ConfidenceBadge`) components, used on `/market`.
- A wide Supabase schema (43 tables, 20+ views) with most of the
  rollups, percentiles, and demand signals the spec wants.
- An ingest pipeline with auth, audit, and admin control.
- `WatchButton` on `/sold`, `/sellers/[id]`, `/price-drops`.
- A working `/api/market/fair-price` adjustment-factor system,
  consumed by both `/whats-it-worth` and Geck Inspect's classifier.

Things the spec asks for that **do not exist** and need to be built:

- Global filter state. Five disconnected filter mechanisms across the
  app (see `ARCHITECTURE.md` "Filter state today").
- `/combo/[slug]`, `/trait/[slug]`, `/region/[code]`, `/indices`,
  `/methodology`, `/watchlist`, `/reports/[month]`.
- The `v_market_sub_index` SQL view (referenced, never implemented,
  causes the sub-index card to render empty).
- Materialised composite index history tables for fast retrieval
  and brushing.
- Watchlists / saved searches schema.
- Email notification sender (Discord/webhook channels exist).
- Per-view CSV export (only `/market` has one today).
- Cross-filtering on `/market` (every widget fetches independently;
  cross-page changes do not propagate within the page either).

### Proposed architecture for Phase 1+

#### 1. URL-driven global filter state

Build a single canonical query-string schema. Proposed keys:

```
?tf=90d&region=US&age=adult&lineage=any&sex=female
 &combos=lw-cap,axa-pin&traits=lilly_white,cappuccino
 &priceMin=200&priceMax=800&sources=mm,extension
 &from=2026-01-01&to=2026-04-30&sort=median_sold_desc
```

Mechanism: a thin custom hook on top of `useSearchParams` +
`router.replace`. **Decline `nuqs` for v1**: extra dep, not worth
it for our scope. If the custom hook starts duplicating nuqs feature
by feature, reconsider.

Server pages read the same schema via Next 14's `searchParams` prop.
Two parser modules under `src/lib/filters/` (proposed):

- `schema.ts`: zod-style parsers and serialisers.
- `link.ts`: helper that takes a target route + override and emits a
  preserve-everything-else `<Link href>`.

Migration plan for the existing five filter shapes:

| Page | Today | After Phase 1 |
|---|---|---|
| `/` Pulse | React context | Same canonical params, hydrated client-side |
| `/market` | local useState | Read + write canonical params |
| `/sold` | `morph`/`maturity`/`sex` URL | Re-emit under canonical keys; keep `morph=` as a back-compat alias |
| `/trends` | `window` | Read `tf` (canonical) with 90d default |
| `/compare` | `sellers` CSV | Add `entities=...` generic (sellers / combos / traits / regions) |

#### 2. Canonical FilterBar component

One component used on every page. Renders only the chips relevant to
the current page. Same keyboard behavior. Lives at
`src/components/filters/FilterBar.tsx` (new), supersedes the
forest-themed `src/components/market/FilterBar.tsx` (kept as a thin
themed wrapper).

Mobile: chips collapse into a single sheet trigger (`<FilterSheet>`).

#### 3. Entity pages

- **`/combo/[slug]`**: canonical slug comes from `combo_catalog`. Add
  a `slug` column with a unique index. Backfill the 12 combos
  hardcoded in `_combo_id_from_traits`. Discoverability: every combo
  pill on Pulse, every row of `RankedCombosTable`, every sub-index
  tile, every Top Movers row links here.
- **`/trait/[slug]`**: slug derived from `morph_taxonomy.canonical`
  via a small slugifier.
- **`/region/[code]`**: enum match against `REGIONS` constant
  (`US`, `EU`, `UK`, `CA`, `AU`, `JP`, `SE`, `SEA`).

Each page reuses existing components:
`MarketIndexCard`-style hero (per entity), `MiniSparkline`,
`TimeSeriesLine`, `RankedCombosTable`, `RegionalHeatmap`,
`SellerLeaderboardScatter`.

#### 4. Indices: compute in Postgres, not Python

The spec proposes computing indices in Python (the scraper pipeline)
and storing them in a time-series table. **Reject** Python-side
computation. Rationale: every input lives in Postgres already
(`market_listings`, `listing_status_events`, `price_history`); the
existing `v_combo_rollups` and `v_market_index` already prove the
"compute in pg" pattern works. Materialised view + scheduled refresh
is the right shape.

Proposed work:

- Migration adds `combo_index_daily` (materialised view, refreshed
  hourly via `pg_cron` or scheduled GH Action).
- Migration adds `v_market_sub_index` (the missing SQL view) plus
  the five composite indices the spec calls out (Lilly White,
  Axanthic, Cappuccino-line, High-end, Entry).
- A small `/api/indices/[id]` read endpoint for `/indices` + future
  external consumers.

#### 5. Cross-filtering on `/market` in < 200ms

The spec asks for sub-200ms cross-panel reactivity. Today each
widget calls `useFilteredQuery` and round-trips Supabase. Proposed
shape: hoist a single canonical dataset fetch into `MarketDashboard`
and let each panel **filter from memory** in response to the trait
selection. This is the single biggest interaction change in Phase 3
and it constrains the data model: the dataset has to fit a few
hundred kB and refresh on filter (timeframe / region) but not on
trait click.

If that constraint cannot be met, fall back to debounced server
refetch with optimistic UI. Decide once the data shape is known.

#### 6. Email notifications

The spec names Resend "or whatever's already wired." Nothing is
wired. Pushing this decision out of Phase 1 into Phase 4. Two
options when we get there:

- **Resend**: cleanest API, free tier covers our volume. ~7KB SDK.
- **Direct Postmark / SES**: cheaper at scale, more glue code.

Recommend Resend. Defer the actual pick until Phase 4 unless
Tennyson wants alerts wired earlier.

#### 7. Branding

The spec calls the product **Geck Intellect**. The header in code
says **Geck Inspect / market**. Treat as branding ambiguity; do not
change the wordmark until Tennyson decides whether the public name
is now "Geck Intellect" or "Geck Inspect Market."

### Risks

1. **Cross-product Supabase**. The same DB feeds the Eye in the Sky
   extension and the Geck Inspect classifier app. Schema changes
   must not break either. Specifically: do not change column
   semantics on `market_listings`, `morph_taxonomy`, or
   `listing_images` without checking both consumers.
2. **Live-site drift not verified**. The two prod URLs both 403 to
   the audit fetcher. Code is the source of truth for the audit; ask
   Tennyson to spot-check the live site once he reads this.
3. **No URL-state library**. Custom hook is fine for our scope. If
   the schema balloons past ~12 keys, swap in `nuqs`.
4. **In-memory cross-filter dataset size**. If a wide listings
   dataset exceeds a few hundred kB gzipped, Phase 3's 200ms goal
   pushes back on the architecture.
5. **`combo_catalog` slug backfill**. The current 12 hardcoded combos
   in `_combo_id_from_traits` need to be deduplicated against
   `combo_catalog` to land entity URLs without breaking the trait
   matcher in `lib/market/combos.ts`.
6. **Branch workflow vs. main workflow**. `CLAUDE.md` says push
   direct to main. This branch (`claude/market-analytics-visualization-zHvqT`)
   exists because the spec asks for explicit approval before Phase 1.
   Once Tennyson approves, default to main per `CLAUDE.md` for
   implementation commits unless he wants the branch retained.

### Sequencing

Phase 1 -> 2 -> 3 -> 4, with Phase 2's index computation as the only
parallelisable thread (a backend-shaped change that can land while
Phase 1's UI work is in flight).

Inside Phase 1:

1. Filter schema + parsers (`src/lib/filters/`).
2. Canonical `FilterBar` component + mobile sheet.
3. Plumb each page in this order: `/market`, `/sold`, `/sellers`,
   `/trends`, `/`, `/compare`. Each plumb-through is a single
   commit.
4. Entity pages: `/combo/[slug]`, then `/trait/[slug]`, then
   `/region/[code]`. Each is one commit.
5. Plumb the entity pages into the existing nav and into every
   table that lists those entities.

### Estimated scope (rough)

- Phase 1: 5-7 working sessions. URL-state + four entity pages +
  cross-page plumbing.
- Phase 2: 3-5 sessions. Index SQL + UI + methodology page + monthly
  report scaffolding.
- Phase 3: 4-6 sessions. Cross-filtering rewrite, brushing,
  spread-analysis upgrade.
- Phase 4: 4-6 sessions. Watchlist schema + UI + email + per-view
  export.

### Housekeeping noted in audit

- `tsconfig.json:17` deprecated `baseUrl`. One-line fix.
- `MultiLineChart.tsx` not read this audit; verify before reusing.
- Add lightweight Playwright or vitest-browser tests once Phase 1
  ships, to lock the URL-state contract.

### What I am NOT proposing

- Replacing D3 with a new chart library.
- Adding `nuqs`, `zustand`, `jotai`, or any client state lib.
- Adding `recharts`, `nivo`, or `plotly`.
- Adding a third-party watchlist or auth provider.
- Materialising every index into a daily table on day one.
  Start with `combo_index_daily` and the explicit named composites;
  add more if and when needed.

### Open questions for Tennyson

These are blocking Phase 1. Each has a recommended answer.

1. **Branding**. Is the product name now "Geck Intellect" (per the
   spec) or still "Geck Inspect" (per the header)? Recommend keeping
   "Geck Inspect" wordmark and treating "Geck Intellect" as the
   marketing surface; rename later if needed.
2. **URL-state library**. Build a custom hook on top of
   `useSearchParams`, or add `nuqs`? Recommend the custom hook for v1.
3. **Indices computed where**. Supabase views + materialised view, or
   Python pipeline? Recommend Supabase.
4. **Email vendor**. Resend, or stick with Discord/webhook channels
   for Phase 4? Recommend Resend in Phase 4.
5. **Live URL**. Confirm the production URL the spec means
   (`geckintellect.geckinspect.com` vs `geck-data.vercel.app`) so I
   can verify drift after Phase 1.
6. **Branch vs main**. Should Phase 1+ commits go direct to main
   (per `CLAUDE.md`), or stay on this branch through approval
   gates? Recommend direct to main per `CLAUDE.md`, with the
   exception of any phase-completion summary commit which can be
   reviewed first.
7. **Methodology copy**. Will you write the plain-language
   methodology explanations, or want me to draft them? Recommend I
   draft, you edit.
8. **Watchlist scope**. For Phase 4, save combos + traits + sellers +
   regions only, or also save full filter URLs as named searches?
   Recommend both: a `watchlist_items` table (combo/trait/seller/
   region) and a `saved_searches` table (named URL + alert
   thresholds).
9. **Top-N for per-combo indices**. The spec says "top N combos by
   volume." What is N? Recommend 25, with the option to opt extras in.
10. **Cross-platform sources in indices**. Should
    `cross_platform_listings` (Fauna, Reptile Forums, Preloved,
    Kijiji) contribute to the composite indices, or stay
    MorphMarket-only? Recommend MorphMarket-only for the composite,
    with a separate `/api/indices/cross_platform` slice exposed
    later if useful.
