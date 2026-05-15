# scripts/

Python pipeline for the Geck Data MorphMarket scraper. Each script is
designed to be safe to run multiple times: every write is an UPSERT, and
incremental scripts skip work that has already been done.

## Setup (local Mac)

```bash
cd scripts
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The scripts read `.env.local` from the repo root automatically (via
python-dotenv). The required vars are:

| Var | Used by |
|---|---|
| `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) | all |
| `SUPABASE_SERVICE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | all |
| `DECODO_AUTH` | scrape_listings.py, scrape_details.py |
| `TRIGGERED_BY` | optional label written to scrape_runs |

In GitHub Actions, those are wired up from repository secrets; see
`.github/workflows/*.yml`.

## Scripts

### check_env.py

Preflight check. Run this BEFORE any other script. It prints which
Supabase project you are connected to, what role your service key has,
whether the required tables/functions/buckets exist, and whether
DECODO_AUTH works. The most common silent failure on this pipeline is
pointing at the wrong Supabase project, and this script makes that
impossible to miss.

```bash
cd scripts
python check_env.py
```

Exits 0 if everything looks healthy.

### scrape_listings.py

Walks the MorphMarket crested gecko grid (~270 pages) through Decodo,
parses the JSON-LD product blocks from each card, and upserts a summary
row per listing into `public.listings`. Appends one row per listing to
`public.listings_history` keyed to the current `scrape_runs.id`.

**Working Decodo recipe (load-bearing — don't drop any of these):**

| Knob | Value | Why |
|---|---|---|
| URL param | `?ordering=-first_posted&page=N` | Server-side Django REST ordering — this is what drives SSR pagination. The React app's `?sort=search-newest` is client-side only; SSR will return the same first 24 listings on every page=N if you use it. |
| `proxy_pool` | `"premium"` | Default residential tier gets soft-throttled into returning page-1 content for every `page=N` call. Premium tier hands back the actual paginated HTML. |
| `browser_actions` | `[wait 5s, scroll_to_bottom, wait 3s]` | MorphMarket's React grid needs hydration time. Without these post-render steps Decodo snapshots before the listing cards are laid out. |
| `headless` | `"html"` | Standard JS render. Required (the page is React). |

If pagination breaks again in the future, check that these three knobs
are still in place before assuming MorphMarket changed anything.

**Modes:**

- **Default (full sweep)**: walk to natural end (~270 pages, ~90 min wall),
  then call `mark_unseen_listings_inactive(target_run_id)` which flips
  `is_active=false` on any listing whose `last_seen_at` predates the
  run. Used by `scrape-listings-weekly-resync.yml` for catalog hygiene.
- **`DELTA_WALK=1`**: load every active `listing_id` at startup, walk
  newest-first, stop as soon as one page contains zero new listings.
  Used by `scrape-listings-daily.yml` for the daily cron. Skips the
  inactive sweep (a partial walk would otherwise corrupt the catalog).
- **`MAX_PAGES=N`**: smoke-test cap. Walks at most N pages. Skips the
  sweep for the same reason.

Other tunables:
- `MM_BASE_URL` overrides the grid URL.

Cost per run:
- Daily delta on a quiet day: 1 Decodo Premium+JS credit (~30s wall).
- Daily delta on a busy day: 1 credit per page until the early-exit
  fires; typically 1–3 credits.
- Weekly full sweep: ~270 credits (~90 min wall).

### scrape_details.py

Reads `listings_needing_detail_scrape(stale_after_days=7)` to get the
subset of listings that need richer fields. Hits each listing detail
page through Decodo with 3 parallel workers and a 2 second per-worker
delay. The Decodo wrapper enforces a global rate cap (10 req/s) and
exponential backoff on 429 / 5xx.

On success, every listing gets a UPSERT into `listings` plus a row in
`listings_history`. After steady state this should be 50-200 listings
per weekly run, not 6,000.

Tunables (env vars):
- `MAX_LISTINGS` cap for smoke tests.

Cost: depends on backlog. Tracked via the `scrape_runs.records_attempted`
counter.

### scrape_sellers.py

Weekly per-seller scrape. Reads the `sellers_needing_scrape` view to
get the subset of seller slugs that are linked from at least one
active listing and haven't been refreshed in the last 7 days. Fetches
each `https://www.morphmarket.com/stores/{slug}` page through Decodo
(same recipe as `scrape_listings.py` — premium proxy + browser_actions
wait/scroll/wait) and upserts a row into `public.sellers`.

Seller slugs are populated by `scrape_details.py`, which extracts them
from each listing's JSON-LD `seller.url`. So a brand-new listing won't
have a slug — and therefore won't seed a seller scrape — until the
next weekly details run touches it.

Captured fields (per the "bare minimum" choice we landed on):
`store_name`, `owner_name`, `location_raw`, `member_since`,
`listings_count`, `avatar_url`. Anything richer (reviews, ratings,
response time, full listing inventory) would need its own pass and
isn't worth the credits at the data-platform stage we're in.

Tunables (env vars):
- `MAX_SELLERS` cap for smoke tests.

Cost: ~700 active sellers → ~700 credits/week, ~2,800/month.

### download_images.py

Reads `listings_needing_image_download()` to get listings whose
`primary_image_url` still points at the MorphMarket CDN. For each:

1. GET the image directly (no Decodo, public CDN).
2. Upload to Supabase Storage bucket `listing-images` at
   `{listing_id}.{ext}`.
3. Update `listings.primary_image_url` to the new public Supabase URL.

Tunables (env vars):
- `MAX_IMAGES` cap for smoke tests.

### upload_local_images.py

One-time helper. Reads images from `~/Desktop/geckscrape/images/` (or
`--dir`), uploads each to `listing-images`, and rewrites the matching
`listings.primary_image_url`.

Flags:
- `--dry-run` walk files and print the plan
- `--limit N` stop after N files
- `--force` re-upload even if the file already exists in the bucket
- `--no-update-rows` upload only, do not update the listings table

Run this LOCALLY on the Mac that has the images. The GH Actions runner
does not have access to your Desktop.

### transform_and_load.py

Pure helper functions shared by every script: weight parsing, trait
list splitting, number / bool coercion, batched chunking. No I/O. Easy
to unit test.

### lib/

- `supabase_client.py` returns a service-role Supabase client. Validates
  env vars up front and dies with a friendly message if anything is
  missing.
- `decodo_client.py` wraps the Decodo Web Scraping API. One requests
  session for keep-alive, automatic exponential backoff on 429 / 5xx,
  a self-imposed rate floor so we never blow past the plan cap.

## Common errors

**`ERROR: SUPABASE_URL is not set`**
The script could not find your `.env.local`. Confirm you ran it from
the repo root (or that the file is at `~/geck-data/.env.local`).

**`ERROR: DECODO_AUTH is not set`**
Same as above. The value should start with `Basic ` followed by the
base64-encoded `user:pass`. If you paste just the base64 part, the
script prepends `Basic ` for you.

**`status 429 (rate limited)` repeatedly**
You hit Decodo's monthly cap or the per-second limit. Either wait, or
top up the plan. The script retries up to 5 times with exponential
backoff before giving up.

**`storage upload failed for ... 409 Conflict`**
You re-uploaded an image without `--force`. The default behaviour is to
skip files that already exist in the bucket. Pass `--force` to overwrite.

**Detail scrape returns 0 listings to scrape**
Expected if every listing has been detailed in the last 7 days. Tune
the `stale_after_days` argument inside `scrape_details.py` if you want
to widen the window.

## Adding to the pipeline

The three scrape scripts share the same skeleton:

1. Insert a `scrape_runs` row with status `running`.
2. Do work, calling `upsert` / `insert` against `listings` and
   `listings_history`.
3. Patch the same `scrape_runs` row with final counts and `success` /
   `partial` / `failed`.

If you add a fourth scrape type, follow that pattern so it shows up in
`/data-admin/runs` and `/data-admin` overview without further work.
