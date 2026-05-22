# Decisions

Running log of architectural choices. One entry per phase (or
sub-phase), reverse chronological. Each entry: what was decided,
why, what was rejected, what changed from the plan, what was
deferred.

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
