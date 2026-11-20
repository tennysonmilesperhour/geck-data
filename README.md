# Geck Data

Crested gecko market data: a Next.js site at
[geck-data.vercel.app](https://geck-data.vercel.app) and the Python scrapers
that fill it. It is the market side of Geck Inspect and reads and writes the
`geck_data` schema in the Geck Inspect Supabase project.

Read paths show crested gecko data only. Other species the scrapers or the
extension pick up are kept, tagged with a `species`, and archived.

> **Stack:** Next.js 15 (App Router) · React 18 · TypeScript · Tailwind 3 ·
> D3 · Supabase (Auth, Postgres, Storage) · Python 3.11 scrapers on GitHub
> Actions · deployed on Vercel.

For where the project stands and what comes next, read
[`ROADMAP.md`](ROADMAP.md). For why things are the way they are, read
[`DECISIONS.md`](DECISIONS.md).

---

## The site

Header pages:

| Route | What it shows |
| --- | --- |
| `/` | **Price check.** Pick morphs as chips and see the typical sale range, sold and asking bands, a confidence line, then matching listings and recent sales. |
| `/morphs` | Morph and trait values |
| `/listings` | Current listings, each priced against similar geckos |
| `/sellers` | Breeders, each priced against the market |
| `/trends` | Week-by-week market movement and morph comparison |
| `/markets` | US, South Korea, Japan, Europe and Canada |

Footer pages: `/methodology`, `/status` (data freshness), `/api-docs`,
`/privacy`, `/terms`. Retired routes (`/market`, `/indices`, `/compare`,
`/sold`, `/trait`, `/combo` and others) redirect to the pages above.

**Members only:** single listings, photos and seller pages need a sign-in.
Aggregates (prices, charts, value tables) stay public. The bulk endpoints
(`/data/market.json`, the snapshot CSV, arbitrage) answer 401 without a
session or token.

Other surfaces: `/login`, `/watchlist`, `/upload` (signed-in drop zone),
`/admin` (analytics, `profiles.role = 'admin'`), `/data-admin` (scrape runs
and manual job triggers, `ADMIN_USER_ID` only).

### API

| Route | Purpose |
| --- | --- |
| `/api/ingest` | Machine-to-machine ingest, `Authorization: Bearer <INGEST_API_KEY>`. The Eye in the Sky extension posts JSON events here. |
| `/api/upload` | The signed-in drop zone's ingest (SQLite `.db`, images, CSVs) |
| `/data/market.json` | Market data Geck Inspect reads (members or token) |
| `/api/status.json`, `/api/version` | Freshness and build info |
| `/api/market`, `/api/market-weekly`, `/api/pulse`, `/api/stats`, `/api/value-report`, `/api/alerts` | Data behind the pages |
| `/api/trigger-scrape` | Starts a GitHub Actions scrape from `/data-admin` |

`/api-docs` on the site documents the public endpoints.

---

## Data: the `geck_data` schema

Geck Data runs from the `geck_data` schema in the Geck Inspect Supabase
project. Both `NEXT_PUBLIC_SUPABASE_DB_SCHEMA` and `SUPABASE_DB_SCHEMA` must be
`geck_data`.

- **Listings and sellers:** MorphMarket listings, their price history and
  stores, plus `cross_platform_listings` from shops outside MorphMarket.
- **Runs:** `scrape_runs` records every scraper run; `/status` and
  `/data-admin` read it.
- **Public read models:** the site reads `listing_market_mv`,
  `listing_week_mv`, `market_asks_mv`, `cross_platform_traits_mv` and
  `v_sold_reconciled` with the publishable key, directly or through SECURITY
  INVOKER RPCs (`market_trend`, `market_weekly`, `compare_trends`,
  `market_compare`, `sold_price_band`, `v_regional_heatmap`, `data_health`).
  Anon read access to those materialized views is intentional.
- **Storage:** crested images go to the public `listing-images` bucket; other
  species to `archive-listing-images`; raw drop-zone files to `raw-uploads`.

**Schema changes belong in the
[geck-inspect](https://github.com/tennysonmilesperhour/geck-inspect) repo.**
`supabase/migrations/` here is an archive of the retired standalone database.
Do not add, replay or apply migrations from this repo, and do not run
`supabase db push`. The `legacy-migrations-read-only` workflow rejects changes
to those files.

---

## Run it locally

Node 22 or newer (CI and production use Node 24).

```bash
npx --yes npm@12.2.1 ci --ignore-scripts
cp .env.local.example .env.local   # then fill in the values
npm run dev
```

`.env.local.example` lists every variable with a comment. The essentials are
the Supabase URL, publishable and anon keys, service role key, the two schema
variables above, `INGEST_API_KEY` and `ADMIN_USER_ID`.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server on localhost:3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm test` | TypeScript tests (`tsx --test tests/*.test.ts`) |
| `npx tsc --noEmit --pretty false` | Type check, required before every push |

CI (`.github/workflows/ci.yml`) runs lint, type check, `npm test`, the build,
and the Python tests on every push and pull request.

---

## The scrapers

Python 3.11, in `scripts/`. Setup and per-script details are in
[`scripts/README.md`](scripts/README.md); running them from a Mac or through
the residential proxy is in [`docs/SCRAPER_SETUP.md`](docs/SCRAPER_SETUP.md),
and recovering a failing job in
[`docs/SCRAPER_RECOVERY.md`](docs/SCRAPER_RECOVERY.md).

```bash
pip install -r scripts/requirements.txt
python -m unittest discover -s tests -p "test_*.py"
python scripts/check_env.py      # preflight: which project, schema and keys you are on
```

| Script | What it does |
| --- | --- |
| `scrape_listings_api.py` | MorphMarket listings through the public JSON API (catalog recrawl, newest, last 7 days) |
| `scrape_listings.py` | MorphMarket grid scrape |
| `scrape_details.py` | Listing details for listings not detailed recently |
| `scrape_sellers.py` | Per-seller store scrape |
| `scrape_cross_platform.py` | Shops outside MorphMarket into `cross_platform_listings` |
| `download_images.py` | Primary images into Supabase Storage |
| `backfill_history.py` | A year of history from sampled old listings |
| `transform_and_load.py` | Shared parsers used by every scraper |
| `check_env.py` | Preflight check, run first |
| `probe_pages.py` | Prints market page structure for writing scrapers |
| `pull_anthropic_billing.py` | Anthropic cost report into `anthropic_billing_daily` |
| `export_training_dataset.py`, `train_morph_classifier.py`, `eval_morph_id.py` | Morph ID training data, classifier and evaluation |
| `seed_geck_inspect.py`, `ingest_show_winners.py`, `mirror_and_ingest_anchors.py` | Feed images into Geck Inspect |
| `migrate_csvs.py`, `backfill_market_listings.py`, `upload_local_images.py` | One-time migrations kept for reference |

Scheduled jobs live in `.github/workflows/`: newest listings, weekday catalog
recrawl, weekly last-7-days API listings, weekday cross-platform shops,
nightly index refresh, weekly adjustment factors, weekly images, and the
weekly details and sellers scrapes. Their current state is in
[`ROADMAP.md`](ROADMAP.md) section 1. MorphMarket blocks GitHub runners
directly, so MorphMarket jobs go through the residential proxy in the
`MORPHMARKET_PROXY_URL` secret.

---

## Deploying

Every push to `main` deploys to production on Vercel. See
[`CLAUDE.md`](CLAUDE.md) for the working rules (type check before pushing,
small commits, ask before destructive changes).

## Companion projects

- [geck-inspect](https://github.com/tennysonmilesperhour/geck-inspect): the
  web app. It reads this data through `/data/market.json` and direct queries,
  and owns the database migrations.
- [eyeinthesky](https://github.com/tennysonmilesperhour/eyeinthesky): the
  Chrome extension that posts marketplace events to `/api/ingest`.

## Baseline checklist

```
[ ] private repo + main protected + CI   [x] dependabot + lockfile
[ ] advisors clean (or exceptions noted)  [ ] backups/PITR confirmed
[ ] PostHog + exceptions on               [ ] uptime incl. checkout URL
[ ] privacy / terms / contact (+refund/shipping/disclaimers if selling)
[ ] support@ email works                  [ ] domain auto-renew on
[ ] revenue lands in business account     [ ] sales tax configured (physical goods)
```

The repository is public, so the private-repo item stays open. CI runs on
pull requests and on pushes to `main`. Dependabot covers npm, pip (`/scripts`)
and GitHub Actions, and `package-lock.json` is committed. PostHog initializes
only when `NEXT_PUBLIC_POSTHOG_KEY` is set, with exception autocapture on;
the item stays unticked until that is confirmed in production.
