# Geck Data pipeline

The MorphMarket scraper + admin dashboard that lives alongside the
existing Geck Inspect app in this repo. This doc is for non-developers,
written in plain English. The existing `README.md` is unchanged; nothing
in it applies to Geck Data.

If you came here from a bug or a confused moment, jump to
[Troubleshooting](#troubleshooting) at the bottom.

## What it does

Three scheduled jobs scrape crested gecko listings from MorphMarket and
land them in the Geck Data Supabase project. A small admin UI at
`/data-admin` shows the latest data and gives you buttons to kick off
each job by hand.

| Job | What it does | Frequency | Decodo cost |
|---|---|---|---|
| Listings scrape | Walks the MorphMarket grid (~264 pages), upserts every listing's summary into `listings`, marks anything not seen as inactive. | Daily 9 AM UTC (disabled until tested) | ~265 Premium+JS credits |
| Details scrape | Re-scrapes listings that have not been detailed in 7+ days, or were never detailed. | Weekly Mon 10 AM UTC (disabled until tested) | depends, usually 50-200 credits/week |
| Images download | Pulls primary images straight from the MorphMarket CDN and uploads them to Supabase Storage. No Decodo cost. | Weekly Mon 11 AM UTC (disabled until tested) | 0 credits |

Decodo budget: $19/mo plan, 19,000 Premium+JS req/month, 10 req/s cap.

## Folder map

```
geck-data/
+- scripts/
|  +- scrape_listings.py        Daily listings scrape
|  +- scrape_details.py         Weekly detail scrape (incremental)
|  +- download_images.py        Weekly image download
|  +- upload_local_images.py    One-time bulk upload from your Mac
|  +- transform_and_load.py     Shared parsers (weight, traits, numbers)
|  +- lib/
|  |  +- supabase_client.py     Service-role Supabase client
|  |  +- decodo_client.py       Decodo HTTP wrapper with retries
|  +- requirements.txt
|  +- README.md                 Python-side details
+- .github/workflows/
|  +- scrape-listings-daily.yml
|  +- scrape-details-weekly.yml
|  +- scrape-images-weekly.yml
+- src/app/
|  +- data-admin/               Gated admin pages (you are the only user)
|  |  +- layout.tsx             ADMIN_USER_ID gate
|  |  +- page.tsx               Overview cards + trigger buttons
|  |  +- listings/page.tsx      Paginated listings browser
|  |  +- morphs/page.tsx        Trait price stats
|  |  +- sellers/page.tsx       Seller leaderboard
|  |  +- runs/page.tsx          Scrape run history
|  +- api/trigger-scrape/route.ts  POST endpoint that fires GH Actions
+- src/lib/geck-data/queries.ts    Reusable server-side data fetchers
+- GECK_DATA.md                    you are here
```

Nothing in `src/app/admin/*` or `src/components/charts/*` was touched.
Those belong to Geck Inspect and stay independent.

## Environment variables

Required values, in addition to the existing Geck Inspect ones in
`.env.local`. The example file is committed at `.env.local.example`.

| Var | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard > Project Settings > API > Project URL. Should be `https://dhotmtgryuovkmsncdby.supabase.co` for Geck Data. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page, "anon public" key. |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`) | Same page, "service_role" key. Never expose this. |
| `DECODO_AUTH` | Decodo dashboard > API > the full "Basic ..." header value. |
| `ADMIN_USER_ID` | Supabase dashboard > Authentication > Users. After you sign up at `/login`, copy the UUID from your row. |
| `GITHUB_PAT` | GitHub > Settings > Developer settings > Personal access tokens > Fine-grained > New token. Grant only `Actions: read and write` on the geck-data repo. |
| `GITHUB_REPO` | `tennysonmilesperhour/geck-data`. |

In Vercel: paste each one in Project Settings > Environment Variables.
For GitHub Actions: Settings > Secrets and variables > Actions > New
repository secret. The workflows reference `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, and `DECODO_AUTH` so name them exactly that.

## First-time setup (after a fresh clone)

1. Make sure `001_initial_schema.sql` ran in the Geck Data Supabase
   project. You can verify by visiting `/data-admin` once everything else
   is wired up; if the listings table is missing you will see an error.
2. Copy `.env.local.example` to `.env.local`, fill in the values above.
3. `npm install` then `npm run dev`, visit http://localhost:3000.
4. Sign up at `/login`. Copy your user id from Supabase dashboard, paste
   into `ADMIN_USER_ID` in `.env.local`, restart `npm run dev`.
5. Visit `/data-admin`. You should see four empty cards and three
   "Trigger run" buttons.
6. Land your historical data:
   - Run `python scripts/upload_local_images.py` (one time, from your
     Mac). This uploads ~5,849 images from `~/Desktop/geckscrape/images/`
     into Supabase Storage and rewrites every `listings.primary_image_url`.
   - Run `python migrate_to_supabase.py` from your local
     `~/Desktop/geckscrape/` to load the CSV rows into `listings` and
     `listings_history`. (The CSV migration script is your original
     local one; we did not duplicate it here.)
7. Add the three secrets to GitHub Actions (Settings > Secrets and
   variables > Actions): `DECODO_AUTH`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`.
8. Go to the Actions tab on GitHub. Click each workflow > "Run workflow".
   Watch the logs. When all three succeed once, uncomment the
   `schedule:` block in each `.github/workflows/*.yml` and push.

## How to trigger a scrape

From the admin UI:

1. Sign in at `/login`.
2. Visit `/data-admin`.
3. Scroll to "Run a scrape" and click the button you want.
4. Within ~30 seconds a new row appears in the "scrape runs" table with
   status `running`. It updates to `success`, `partial`, or `failed`
   when the GH Action finishes.

From GitHub directly:

- Actions tab > pick a workflow > Run workflow > main > Run workflow.

From the Mac terminal (testing scripts before they go live):

```bash
cd scripts
python scrape_listings.py
python scrape_details.py
python download_images.py
```

Each respects an env var to limit scope for smoke testing:
`MAX_PAGES=2` on listings, `MAX_LISTINGS=10` on details,
`MAX_IMAGES=10` on images.

## Troubleshooting

**"/data-admin says Not authorised"**
You are signed in but your user id does not match `ADMIN_USER_ID`. The
page shows your id, paste it into Vercel env vars (or `.env.local` for
local dev) and reload.

**"Trigger run" returns 502 or 500**
The API route could not reach GitHub. Check that `GITHUB_PAT` is set and
unexpired, and that `GITHUB_REPO` matches exactly. The token needs
"Actions: read and write" on this repo.

**A scrape ran but the listings table is still empty**
Look at the `runs` table for the failed row's `error_message`. Most
common: the GH Actions secret `SUPABASE_URL` points at the wrong
project. It should be `https://dhotmtgryuovkmsncdby.supabase.co`.

**Decodo says rate limited (429)**
The script retries up to 5 times with exponential backoff. If a whole
run fails on 429, your plan probably hit its monthly cap. Check the
Decodo dashboard.

**The morphs page is empty**
The `morph_price_stats` view requires at least 3 active listings per
trait. Until your data is loaded, this is normal.

**Images do not show in `/data-admin/listings`**
The `primary_image_url` column still points at MorphMarket's CDN. After
the weekly images job runs (or you run `upload_local_images.py`), the
URLs flip to the Supabase Storage public URL.

## Related docs

- `scripts/README.md` covers the Python side in detail.
- `README.md` is the Geck Inspect doc, untouched and unrelated to this
  pipeline.
