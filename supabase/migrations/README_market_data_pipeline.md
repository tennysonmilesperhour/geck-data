# /market data pipeline migrations

Files:
- `0005_market_analytics_views.sql` — derived views + helpers reading the
  existing `market_*` / `price_history` / `listing_status_events` tables
- `0006_breeding_schema.sql` — user-tracked breeding records + the
  forward-looking supply-pipeline view

After running **both**, the `/market` dashboard swaps every widget from
deterministic fixtures to Supabase-backed queries. The UI falls back to
fixtures when a query returns empty or errors so the dashboard never goes
blank during the transition.

Prerequisite: `0003_admin_analytics.sql` must already be applied
(`public.is_admin()` is referenced by 0006's RLS policies).

---

## 0005 — market analytics views

Read-only derived structure over existing tables. No new base tables.

### Catalog + helpers

- **`combo_catalog (combo_name, tokens[])`** — the canonical 12-combo list
  the UI uses. Rows are seeded on migration; re-running is idempotent.
- **`combo_match(traits text) → text`** — returns the first combo whose
  `tokens` are all substrings of the lowercased `traits` string. Used by
  every rollup so a listing's combo is derived consistently.
- **`region_of(seller_location text) → text`** — coarse bucketing to
  `US / CA / EU / UK / AU / JP / SE / SEA` via country/city/state regexes.

### Parameterised table functions

All take `window_days int` so the `/market` timeframe selector can pick
the period without re-materializing:

- **`v_combo_rollups(window_days)`** — per-combo: `sold_count`, `live_count`,
  `median_sold`, `median_ask`, `spread_pct`, `avg_days_to_sell`,
  `confidence_score`. Confidence = `20 + 2·sold_count + 0.5·live_count`,
  clamped to 1..99.
- **`v_regional_heatmap(window_days)`** — per-combo × region:
  `n, median_sold, median_ask, confidence_score`.
- **`v_market_index(window_days)`** — weekly geometric-mean basket of
  combos' median sold prices, rebased so the first week = 1000.
- **`v_combo_source_blend(p_combo, window_days)`** — per-source share of
  observations for a single combo's price_history.

### RLS

All base tables already permit public SELECT (from 0001/0002). Functions
are `stable` + caller-scoped (not `SECURITY DEFINER`) so they respect those
policies.

---

## 0006 — breeding schema

Adds three owner-scoped tables that back the `/market` **Supply** tab.
Nobody can see another user's pairs; the admin role reads them all through
the aggregate view.

- **`breeding_pairs`** — `(id, owner_id, nickname, female/male_morph,
  combo_name, active, paired_at, notes)`. FK'd to `auth.users` and
  `combo_catalog`.
- **`clutches`** — `(id, pair_id, laid_on, expected_hatch_on, egg_count,
  fertile_count, notes)`. `expected_hatch_on` defaults to `laid_on + 65d`
  via a `before insert` trigger.
- **`hatchlings`** — `(id, clutch_id, hatched_on, morph_guess, sex, notes)`.

### RLS

| table | owner | admin |
|---|---|---|
| `breeding_pairs` | read/write own rows | read all |
| `clutches` | read/write via own pair | read all |
| `hatchlings` | read/write via own pair | read all |

### Aggregate view

**`v_supply_pipeline_monthly`** — one row per `(month, combo_name)` with
`projected_juveniles` for the next 9 months. Runs with
`security_invoker = true` so a caller sees their own pairs; admins see
every pair. The projection combines:

1. **Confirmed clutches**: `fertile_count`, or `0.8 × egg_count` if the
   fertility column is still null, attributed to the expected-hatch month.
2. **Projected future clutches**: per active pair, a seasonal clutch rate
   (peaks Apr–Jun, tails off through August, minimal Sep–Mar) × 2 eggs ×
   0.8 fertility, attributed to the pair's combo.

Aggregation is always to `(month, combo)` — individual owner identity
never appears in the output.

---

## What it unlocks

Running 0005 + 0006 replaces these fixture calls with live Supabase
queries (see `src/lib/market/queries.ts`):

| Widget | Previously | After |
|---|---|---|
| Market Index (Overview hero) | fixture | `v_market_index()` |
| Top Movers | fixture | `v_combo_rollups()` + prior-window delta |
| Peak Indicator grid | fixture | `v_combo_rollups()` composite scoring |
| Combos ranked table | fixture | `v_combo_rollups()` |
| Combos detail chart | fixture | `price_history` + `v_combo_source_blend()` |
| Regional heatmap | fixture | `v_regional_heatmap()` |
| Arbitrage table | fixture | `v_regional_heatmap()` + `v_combo_source_blend()` |
| Supply pipeline | fixture | `v_supply_pipeline_monthly` |
| Breeders table | fixture | `market_sellers` + `seller_snapshots` |

Widgets that still can't resolve their data gracefully fall back to the
fixture, with a small "preview" tag so an admin can tell at a glance
which slice is still awaiting real rows.
