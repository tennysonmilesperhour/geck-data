# Architecture

State of the code as of the Phase 0 audit. This file gets updated as
each phase ships. The audit details below are the baseline.

## Stack

- **Framework**: Next.js 14.2.15, App Router, React 18.3.
- **Language**: TypeScript 5. `tsc --noEmit` clean as of audit.
  `tsconfig.json` still uses the deprecated `baseUrl` option; a
  one-line fix lands in DECISIONS as housekeeping.
- **Styling**: Tailwind 3.4. Custom theme tokens (`ink-*`,
  `forest-*`, `claude-*`, `ready`, `busy`, `warn`, `danger`,
  `info`). Two themed atmospheres: default slate-ish, plus a
  `.market-theme` scope used on `/market` and `/whats-it-worth`.
- **Charts**: D3 7.9 for 16 charts under `src/components/charts/`,
  pure SVG for `MiniSparkline` and the two `InlineCharts` primitives
  (`AreaChart`, `Sparkline`). No Recharts, no Plotly, no nivo.
- **Backend**: Supabase (`@supabase/ssr` ^0.5.2, `@supabase/supabase-js`
  ^2.45.4). Three client variants under `src/lib/supabase/`:
  `client` (browser), `server` (RSC + route handlers), `admin`
  (service-role).
- **Hosting**: Vercel. `vercel.json` is plain (`next build`,
  `next dev`).
- **Other deps**: `react-dropzone`, `sql.js`, `topojson-client`,
  `us-atlas`. No URL-state library (`nuqs` etc.) installed.

## Routes

| Route | Role | Filter state | Notes |
|---|---|---|---|
| `/` | Pulse landing | `LandingFiltersProvider` (in-memory React context) | combos, hoveredCombo, priceBand |
| `/whats-it-worth` | Price estimator | local `useState` | calls `/api/market/fair-price` |
| `/sold` | Sold listings + comps | URL: `morph`, `maturity`, `sex` | server component, uses `sold_listings_v` |
| `/price-drops` | Price drops feed | none | reads `price_drops` + `market_listings` |
| `/sellers` | Seller directory | none | top six + table + sparkline column |
| `/sellers/[id]` | Per-seller page | none | exists, has `WatchButton`, percentile, histogram, snapshots |
| `/market` | Market dashboard, tabbed | local `useState` in `MarketDashboard` | tabs: Overview, Combos, Regional, Arbitrage, Supply, Breeders |
| `/trends` | Longitudinal view | URL: `window` (90/180) | weekly added vs sold, cumulative delta, median price, maturity bands |
| `/compare` | Side-by-side | URL: `sellers` (CSV ids) | trait premium + maturity bands + seller h2h |
| `/shows` | Show mentions | none | aggregated `show_mentions` |
| `/cross-platform` | Off-MorphMarket listings | none | platform-grouped |
| `/alerts` | Saved queries + matches (login) | none | uses `alerts`, `alert_matches`, `WatchButton` |
| `/listings/[id]` | Per-listing page | none | exists, has price history sparkline + status timeline |
| `/login` | Email/password | URL: `next` | Supabase auth |
| `/upload` | Drop zone (gated) | none | `.db`, images, CSVs |
| `/settings` | User settings | none | chart prefs etc. |
| `/daily-log` | Per-day event panels | none | event aggregation |
| `/status` | Public ingest status | none | per-stream counts + freshness |
| `/admin/analytics` | Operator dashboard (admin) | none | Growth / Engagement / Features / Retention / Errors |
| `/data-admin/...` | Pipeline admin (admin) | URL: `page` paginations | scrape control + raw browsers |
| `/embed/market-temperature` | Single-widget embed | none | for external sites |

**Routes the spec wants that do not exist**: `/combo/[slug]`,
`/trait/[slug]`, `/region/[code]`, `/methodology`, `/indices`,
`/reports/[month]`, `/watchlist`.

## Filter state today

Five different filter mechanisms exist across the app. None of them
talk to each other. This is the central gap to close in Phase 1.

1. **`LandingFiltersProvider`** (`src/components/landing/LandingFilters.tsx`),
   client React context, in-memory. Holds `hoveredCombo`,
   `selectedCombos: Set<string>`, `priceBand`. Used by `/` only.
2. **`MarketDashboard` local state**
   (`src/components/market/MarketDashboard.tsx`). Holds `Filters`
   (`timeframe`, `region`, `age`, `lineage`, `sources`), the tab
   selection, and a `selectedCombo`. Lost on navigation away from
   `/market`.
3. **URL searchParams on `/sold`**: `morph`, `maturity`, `sex`.
   Server-side parsed, filter narrows a fetched dataset.
4. **URL searchParams on `/trends`**: `window` (90 or 180).
5. **URL searchParams on `/compare`**: `sellers` (CSV of seller ids).

There is no shared schema, no shared parser, no shared component.
Cross-page navigation always loses state. This is the largest deviation
from "make the system feel like a system."

## Data layer

### Tables

43 tables defined across `supabase/migrations/`. Market-relevant:

- `listings`, `listings_history`, `scrape_runs` (from the Python
  pipeline, see `BRIEF.md`).
- `market_listings`, `market_sellers` (the canonical read tables on
  the dashboard side).
- `listing_status_events` (live / sold / removed), `price_history`,
  `price_drops`, `seller_snapshots`.
- `listing_images`, `cross_platform_listings`,
  `cross_platform_listing_images`, `listing_image_phash_pairs`,
  `external_reference_images`.
- `morph_taxonomy`, `crested_morph_taxonomy`, `morph_taxonomy_synonyms`,
  `combo_catalog`, `trait_tiers`, `listing_lineage`.
- `auction_results`, `auction_state`, `show_mentions`.
- `alerts`, `alert_matches`, `alert_delivery_attempts`,
  `user_notification_channels`.
- `profiles`, `user_events`, `error_logs`.
- `listing_views`, `listing_favorites` (demand signals,
  anonymous, per-browser).
- `price_adjustment_factors` (drives `What's it worth?` adjustments,
  migration 0033).
- `model_invocations`, `morph_eval_runs`, `morph_human_labels`,
  `ingest_audit`, `ingest_events`, `batch_jobs`, `runtime_config`,
  `runtime_config_history`, `anthropic_billing_daily`,
  `breeding_pairs`, `clutches`, `hatchlings`.

### Views and RPCs

- `v_combo_rollups(window_days)` (RPC, 0005): per-combo median sold,
  live count, sold count, spread %, avg days to sell, confidence.
  **The workhorse of the Market page.**
- `v_market_index(window_days)` (RPC, 0005): weekly weighted basket
  of high-value combos.
- `v_market_temperature` (view, 0029): weekly composite 0..100.
- `v_combo_price_distribution` (view, 0029): per-combo p10/25/50/75/90
  over last 180d sold.
- `v_cross_platform_arbitrage_pairs` (view, 0029): pHash-joined
  candidates.
- `v_seller_reputation` (view, 0029): latest seller snapshot + 30d
  sold count.
- `v_demand_index` (view, 0030): views + favorites composite.
- `v_recent_combo_sales` (view, 0033): 5 most recent sales per combo.
- `sold_listings_v` (view, 0005): joined sold-listing comps for /sold.
- `morph_price_stats`, `seller_stats` (views, 0001).
- Plus telemetry/training views (`v_daily_activity`,
  `v_trait_recognition_metrics`, `v_ingest_health_*`, `v_model_spend_*`).

### Stubbed but not implemented

- **`v_market_sub_index`**. Referenced by
  `fetchMarketSubIndices` in `src/lib/market/queries.ts:131-135`,
  which always returns `empty(null, "v_market_sub_index not
  implemented")`. The `MarketSubIndices` UI tile renders nothing
  because of this. This is the one explicit "Loading..." style
  empty state in the production code.
- **Materialised composite indices history**. No
  `market_index_history`, `combo_index_daily`, or `trait_index_daily`
  tables. Every index is recomputed from raw data per request.
- **Watchlists / saved searches**. No table exists. `WatchButton`
  exists but writes into `alerts`, not a watchlist.

## API endpoints

All under `src/app/api/`:

- `/api/ingest` (POST, Bearer): the extension event firehose.
- `/api/upload` (POST, session): drop-zone upload handler.
- `/api/trigger-scrape` (POST, admin): triggers GH Actions workflow.
- `/api/stats` (GET): aggregated counts.
- `/api/status.json` (GET): per-stream ingest status.
- `/api/runtime-config` (GET).
- `/api/market/temperature` (GET): wraps `v_market_temperature`.
- `/api/market/fair-price` (GET/POST): wraps
  `v_combo_price_distribution` + `price_adjustment_factors`. Used by
  `/whats-it-worth` and Geck Inspect's classifier (see
  `docs/geck-inspect-integration.md`).
- `/api/market/arbitrage` (GET): wraps
  `v_cross_platform_arbitrage_pairs`.
- `/api/market/snapshot.csv` (GET): CSV export of current market
  state. **The only CSV export in the app.**
- `/api/market/traits` (GET): trait vocabulary for the picker.
- `/api/training/*` (admin): ML pipeline endpoints.
- `/api/import/inaturalist` (POST): image import.
- `/api/alerts/from-url` (POST), `/api/alerts/[id]/acknowledge` (POST):
  alert lifecycle.
- `/data/market.json` (GET, under `src/app/data/market.json/route.ts`):
  the snapshot consumed by the Geck Inspect classifier app.

## Charts

`src/components/charts/`:

| File | Implementation |
|---|---|
| `MiniSparkline.tsx` | pure SVG, slope-tinted |
| `TimeSeriesLine.tsx` | D3 |
| `PriceHeatmap.tsx` | D3 |
| `DaysToSellHistogram.tsx` | D3 |
| `TraitFrequencyAndPrice.tsx` | D3 |
| `BubbleChart.tsx` | D3 |
| `Sunburst.tsx` | D3 |
| `RidgePlot.tsx` | D3 KDE |
| `GeoMap.tsx` | D3 + TopoJSON |
| `PriceHistogram.tsx` | D3 |
| `CumulativeSales.tsx` | D3 |
| `Treemap.tsx` | D3 |
| `CalendarHeatmap.tsx` | D3 |
| `ForceGraph.tsx` | D3 force |
| `SellerLeaderboardScatter.tsx` | D3 |
| `BoxPlot.tsx` | D3 |
| `theme.ts` | shared palette + tokens |

`src/components/market/charts/`:

| File | Implementation |
|---|---|
| `InlineCharts.tsx` (`AreaChart`, `Sparkline`) | pure SVG |
| `MultiLineChart.tsx` | (not read in this audit, likely D3) |

`ChartGrid` (`src/components/charts/ChartGrid.tsx`) is a per-page
chart registry; each page passes a `page` slug and a `ctx`, and the
registry chooses which charts to render. `src/lib/charts/registry.tsx`
and `src/lib/charts/prefs.ts` back this. Chart settings (which charts
are visible, hidden, etc.) live in `SettingsDrawer`.

**Verdict**: not a mess. Keep D3. The spec's offer to consolidate is
not needed.

## Auth and middleware

- `src/middleware.ts` runs on every request. Refreshes Supabase
  session cookies. Gates `/upload`, `/api/upload`, `/admin` to
  logged-in users. Passes through if Supabase env vars are missing
  (so deploys do not 500 on cold start in a misconfigured preview).
- `Header.tsx` reads `profiles.role` on the client and adds an
  "Analytics" link for admins. The admin layout
  (`src/app/admin/layout.tsx`) re-checks server-side as belt and
  braces.
- `/data-admin/layout.tsx` gates on `ADMIN_USER_ID` env var.

## Source attribution and confidence

Two reusable surfaces:

- `SourceBadge` and `SourceBadgeList`
  (`src/components/market/SourceBadge.tsx`) render the
  source-attribution chips. The source catalogue lives in
  `src/lib/market/sources.ts`. Sources currently named:
  `gi_sales`, `gi_listings`, `gi_breeding`, `pangea`, `morphmarket`,
  `breeder`, `fauna`, `kijiji`.
- `ConfidenceBadge` (`src/components/market/ConfidenceBadge.tsx`) +
  the `Confidence` / `tierFor` types in `src/lib/market/types.ts`.

Both used on `/market` widgets only. Not propagated to `/sold`,
`/sellers`, `/trends`, `/compare`. Phase 4 asks for these everywhere;
the components already exist.

## Notification channels

`user_notification_channels` (migration 0030) and
`alert_delivery_attempts` (migration 0032) provide the persistence
side of an alert delivery pipeline. `src/lib/alerts/notify.ts` exists
as the sender. There is **no email integration** (no Resend, SendGrid,
or Nodemailer). The Discord / generic webhook side exists; email is a
Phase 4 ask that requires a new dependency decision (see DECISIONS).

## Tests

`tests/*.test.ts` runs under `tsx --test`. Coverage: alerts matcher,
alert URL parser, combos, age, traits, price-adjust, lineage,
synonyms, HMAC. No UI tests, no integration tests against Supabase.

## Known issues found in the audit

- `v_market_sub_index` is referenced but never implemented; the
  sub-index card always renders as empty.
- The combo recognition function (`_combo_id_from_traits` in 0029)
  hardcodes 12 combos. The trait-set search on `/whats-it-worth`
  bypasses this and computes percentiles ad hoc. Per-combo entity
  pages need a canonical slug source (likely `combo_catalog` plus a
  slug column).
- The "live URL" referenced in the spec
  (`geckintellect.geckinspect.com`) and the URL referenced in
  `CLAUDE.md` (`geck-data.vercel.app`) both 403 to the headless
  fetcher used in this audit, so the on-the-ground drift between code
  and live could not be verified. Drift is assumed minimal because
  `main` direct-pushes to prod, but Tennyson should spot-check after
  Phase 0 approval.
- `tsconfig.json:17` uses the deprecated `baseUrl` option (one-line
  fix when convenient).
