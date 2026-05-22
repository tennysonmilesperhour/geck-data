# Intent

The destination is a market intelligence tool that lets a user follow
an intuition through the data without dead-ending. The work is split
into four phases. Each phase has an acceptance bar a user can feel.

The four phases below are the spec verbatim, condensed. The
implementation plan lives in `DECISIONS.md` and gets updated after
each phase ships.

## Phase 1: make the system feel like a system

Goal: every page reads from and writes to a single shared filter
state. Every entity (combo, trait, seller, region) has a canonical
page. Navigation never loses context.

- URL-driven global filter state. One canonical query-string schema.
  Every nav link preserves the relevant subset. Every chart reads
  from this state.
- One canonical filter component used on every page.
- Per-combo pages at `/combo/[slug]`: state strip, price history,
  current listings, sold history, regional spread mini-map.
- Per-trait pages at `/trait/[slug]`: same shape, plus a "combos
  including this trait" section.
- Per-region pages at `/region/[code]`: top combos by volume, median
  ask, velocity, top sellers in that region.
- Per-listing detail pages already exist at `/listings/[id]`. Upgrade
  them to surface comparable sold prices and a "is this a deal?"
  verdict against the combo median.
- Plumb the existing Sellers, Sold, Drops, Market, Trends pages into
  the global filter state. Filtering anywhere updates everywhere
  the filter is meaningful.

Acceptance: from Pulse, click any combo chip, land on the combo page,
click "see sellers", land on Sellers filtered to that combo, click a
seller, land on the seller page with the combo filter still applied.
State never silently resets.

## Phase 2: indices and the long arc of time

Goal: composite indices that give people a single number to track
instead of designing their own metric. Sparklines that turn every
table into a market tape.

- Compute composite indices (Geck Intellect Composite, Lilly White,
  Axanthic, Cappuccino-line, High-end, Entry, per-combo top N).
  Methodology: smoothed median with rolling window, sample-size
  shading. Computed in Supabase, not Python (see DECISIONS).
- Reusable Sparkline component on every combo row, every seller card,
  every trait chip.
- Index dashboard at `/indices`.
- Methodology page at `/methodology`. Plain-language explanation of
  every derived metric.
- Auto-generated monthly market report at `/reports/[month]`.

Acceptance: Tennyson can open `/indices`, see the Lilly White Index
moved -4% over 30 days, click through to a chart that lets him brush
a date range, and that brushed range carries over to every related
view.

## Phase 3: true exploration

Goal: Level 2 interactivity. Cross-filtering, side-by-side
comparison, sold-vs-ask spread.

- Cross-filtering on the Market page. Click a trait in the trait
  ridge, the geography panel and velocity histogram and cadence
  heatmap all narrow. Click a region, the trait ridge narrows.
- Compare page rebuild. Drop any two entities (combos, sellers,
  regions, traits) into a two-column layout.
- Sold view with spread analysis. Per-row spread (absolute and %),
  days to sell, page-level histogram of spreads.
- Time-range brushing across all time-series pages.
- Trends page upgrade: connect to the filter system, gain brushing,
  add trait frequency over time, sold volume over time, percentile
  bands over time.

Acceptance: on the Market page, clicking "Lilly White" in the trait
ridge narrows every other panel on the page in under 200ms. The
cause-and-effect feels obvious without explanation.

## Phase 4: personalization, trust, exits

Goal: users (and Tennyson) can save state, get alerted, and trust
where every number came from.

- Watchlists: save combos, traits, sellers, regions. Personal
  dashboard at `/watchlist`. Existing Supabase auth.
- Alerts: email (Resend, after explicit sign-off; existing
  Discord/webhook channels are already wired). Configurable per
  watchlist item.
- Source transparency: every chart shows which sources contributed.
  Already partially in place; make it consistent.
- Sample-size and confidence everywhere. Faded when n low. Already
  partially in place; make it consistent.
- CSV/JSON export on every data view.
- Public API documentation for the read-only endpoints.

Acceptance: Tennyson can save a watchlist, get an email when a
Lilly White x Cappuccino drops below $400, click through to the
listing, see exactly how the median was computed, and download the
underlying data. Every step takes one click.

## Cross-cutting bar for every phase

- First paint under 2s on prod Vercel.
- Mobile-ready: filter chips collapse to a sheet, tables become
  cards, charts touch-scroll.
- Keyboard navigation works for filters. Charts have alt-text
  summaries. Color is never the only signal.
- One chart styling, one number format, one date format. Keep D3
  as the implementation; do not add a new charting library.
- Hover-definition pattern for every domain term, using the existing
  `MorphTerm` component.
- Zero em dashes in any output (UI, comments, markdown).
