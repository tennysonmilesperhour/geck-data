# Geck Data \- Full Implementation Brief

You are Claude Code working in the `tennysonmilesperhour/geck-data` repo. Read this entire document before writing any code, then implement end-to-end. Ask before doing anything ambiguous.

---

## Who you're building for

Tennyson is a solo builder with NO coding experience. He understands concepts and architecture at a high level but cannot debug code himself. Default to:

- Heavy comments explaining what code does in plain English  
- Verbose logging in scripts so he can see what's happening  
- Defensive coding (try/except, sensible defaults)  
- Safe operations (UPSERT not INSERT, soft-deletes not hard, dry-run options)  
- Asking him before introducing libraries, patterns, or services he won't recognize

He uses zsh on a Mac mini. Commands should assume macOS.

NEVER use em dashes in any code comments or documentation \- he hates them. Use regular dashes, commas, or parentheses, or rewrite the sentence.

---

## What we're building

A market intelligence pipeline \+ admin dashboard for crested gecko listings scraped from MorphMarket. The pipeline is already working locally \- we're moving it into this repo, making it incremental, automating it via GitHub Actions, and giving Tennyson an admin UI to monitor and control it.

End state: Tennyson opens a deployed Vercel URL, logs in, sees live market data, can trigger scrapes manually, and the data automatically refreshes on schedule.

---

## Architectural decisions already made

1. **Repo:** `tennysonmilesperhour/geck-data` (this one). Tennyson says it already exists with some scaffolding. INSPECT it before scaffolding new structure. Adapt to what's there.  
     
2. **Supabase:** A SEPARATE Supabase project from `geck-inspect`. Tennyson has already (or will have) created a dedicated geck-data Supabase project. Do NOT touch the existing geck-inspect Supabase project. The two are intentionally isolated for now.  
     
3. **Schema:** All market data lives in the default `public` schema of the geck-data Supabase project. No `market.*` prefix needed since this DB is dedicated.  
     
4. **Visibility:** Internal/admin-only at first. Build admin views, do NOT build polished public-facing UI yet. Public pages come later when the admin proves out the data quality.  
     
5. **Hosting:** Vercel, same team/account as geck-inspect.  
     
6. **Decodo plan:** $19/month, 10 req/s rate limit, 19,000 Premium+JS req/month. Incremental scraping is critical to staying within budget.

---

## What Tennyson has already done (do NOT redo)

By the time you read this:

1. Created the new geck-data Supabase project.  
2. Run the schema migration `001_initial_schema.sql` in that project's SQL Editor.  
3. Run `migrate_to_supabase.py` to load \~5,849 listings from his local CSV.  
4. Has primary images downloaded locally in `~/Desktop/geckscrape/images/`.

**First thing to do**: connect to the geck-data Supabase project and verify:

SELECT COUNT(\*) FROM listings;        \-- expect \~5,849

SELECT COUNT(\*) FROM scrape\_runs;     \-- expect 1

SELECT COUNT(\*) FROM listings\_history;-- expect \~5,849

If those are zero, STOP and ask Tennyson to complete the migration first.

---

## Reference files in Tennyson's local geckscrape folder

These exist on his Mac at `~/Desktop/geckscrape/` and are the working reference. Do NOT delete or modify them \- they're his backup. Read/copy as needed.

- `scrape_listings.py` \- scrapes 264 listing-grid pages via Decodo, \~15 min  
- `scrape_animal_details.py` \- scrapes individual listings, 3 parallel workers, 2 sec delay, 10 hours, has 429 backoff  
- `download_images.py` \- downloads primary images directly from CDN (no Decodo cost), has \--test mode and auto-stop  
- `crested_geckos_basic.csv` \- listings summary, \~6,003 rows  
- `crested_geckos_full.csv` \- full details, \~5,849 rows  
- `crested_geckos_full.jsonl` \- raw JSON-LD product blocks per listing  
- `images/` \- \~5,849 primary images named `{listing_id}.jpg` or .webp

Ask him to send specific files if you need them for reference.

---

## Database schema (already created in Supabase)

Tables:

- `listings` \- one row per listing\_id, UPSERTed on each scrape, has fields for name/price/sex/weight/traits/images/timestamps/is\_active  
- `listings_history` \- append-only, one row per observed state of a listing  
- `scrape_runs` \- metadata per scrape job (start, end, status, counts)  
- `morphs` \- canonical morph names \+ aliases (empty initially, populated over time)

Views:

- `morph_price_stats` \- precomputed price stats per trait  
- `seller_stats` \- precomputed seller activity stats

Helper functions:

- `listings_needing_detail_scrape(stale_after_days INTEGER DEFAULT 7)` \- returns listing IDs needing the expensive detail scrape  
- `listings_needing_image_download()` \- returns listing IDs whose primary\_image\_url is still pointing at MorphMarket CDN (not yet uploaded to Supabase Storage)

Row Level Security is enabled. The service\_role key bypasses RLS for the scripts. Authenticated users get SELECT access via existing policies.

---

## Implementation tasks (in order)

### Task 1: Inspect and adapt to existing repo structure

This repo already exists. Check what's there before scaffolding anything:

- Is it a Next.js app? What version?  
- Does it have Tailwind? shadcn/ui? Recharts?  
- Are there any existing scripts? Routes? Components?  
- What's in package.json?

Report back to Tennyson what you find before doing anything destructive. If the repo is empty or near-empty, scaffold Next.js 14 with App Router, TypeScript, Tailwind. If it's already set up, adapt to what's there.

### Task 2: Target folder structure (final state)

geck-data/

\+- app/                                  Next.js App Router

|  \+- layout.tsx

|  \+- page.tsx                           Landing page \- "Coming soon" or login redirect

|  \+- login/page.tsx                     Supabase Auth login

|  \+- admin/

|  |  \+- layout.tsx                      Gates by ADMIN\_USER\_ID

|  |  \+- page.tsx                        Admin home

|  |  \+- listings/page.tsx               Raw listings browser

|  |  \+- morphs/page.tsx                 Morph breakdown

|  |  \+- sellers/page.tsx                Seller breakdown

|  |  \+- runs/page.tsx                   Scrape run history

|  \+- api/

|     \+- trigger-scrape/route.ts         POST endpoint that triggers GH Actions workflow\_dispatch

\+- scripts/                              Python pipeline

|  \+- scrape\_listings.py

|  \+- scrape\_details.py

|  \+- download\_images.py

|  \+- transform\_and\_load.py              Shared CSV/JSON to Supabase logic

|  \+- lib/

|  |  \+- supabase\_client.py

|  |  \+- decodo\_client.py

|  \+- requirements.txt

|  \+- README.md

\+- supabase/

|  \+- migrations/

|     \+- 20260511000001\_initial\_schema.sql  (matches what Tennyson already ran)

\+- lib/

|  \+- supabase.ts                        Server-side Supabase client

|  \+- supabase-browser.ts                Browser-side client

|  \+- queries.ts                         Reusable data fetching functions

\+- components/

|  \+- ui/                                shadcn/ui components

|  \+- charts/                            Recharts wrappers

\+- .github/workflows/

|  \+- scrape-listings-daily.yml

|  \+- scrape-details-weekly.yml

|  \+- scrape-images-weekly.yml

\+- .env.local.example

\+- README.md

\+- package.json

\+- next.config.js

\+- tsconfig.json

### Task 3: Install dependencies

If not already present:

npm install @supabase/supabase-js @supabase/ssr recharts lucide-react

npx shadcn-ui@latest init

npx shadcn-ui@latest add button card table badge input

For Python:

scripts/requirements.txt:

  requests\>=2.31

  supabase\>=2.0

  python-dotenv\>=1.0

### Task 4: Environment variables

`.env.local.example`:

NEXT\_PUBLIC\_SUPABASE\_URL=https://your-geck-data-project.supabase.co

NEXT\_PUBLIC\_SUPABASE\_ANON\_KEY=eyJ...

SUPABASE\_SERVICE\_KEY=eyJ...

ADMIN\_USER\_ID=\<tennysons-supabase-auth-user-id\>

GITHUB\_PAT=\<personal-access-token-for-triggering-workflows\>

GITHUB\_REPO=tennysonmilesperhour/geck-data

The actual `.env.local` is gitignored. Tennyson fills it in himself. Walk him through where to find each value.

### Task 5: Move scrapers into scripts/

Get the local scripts from `~/Desktop/geckscrape/`. Ask Tennyson to paste them or grant access. Then refactor each:

**scripts/scrape\_listings.py**

Algorithm unchanged from the local version \- 264 listing pages via Decodo with headless=html. But replace local CSV output with:

\# At start: create scrape\_runs row

run\_id \= supabase.table("scrape\_runs").insert({

    "scrape\_type": "listings",

    "status": "running",

    "triggered\_by": os.environ.get("TRIGGERED\_BY", "manual"),

}).execute().data\[0\]\["id"\]

\# For each successfully scraped page, immediately:

supabase.table("listings").upsert(rows, on\_conflict="listing\_id").execute()

\# (Sets last\_seen\_at \= NOW(), preserves first\_seen\_at)

\# At end: mark listings not seen in this run as inactive

supabase.rpc("mark\_unseen\_listings\_inactive", {"scrape\_run\_id": run\_id}).execute()

\# Mark the scrape\_run as success or partial

Add this SQL function to a new migration:

CREATE OR REPLACE FUNCTION mark\_unseen\_listings\_inactive(target\_run\_id BIGINT)

RETURNS INTEGER

LANGUAGE plpgsql

SECURITY DEFINER

AS $$

DECLARE

    updated\_count INTEGER;

BEGIN

    \-- Find the scrape\_run's start time

    UPDATE listings

    SET is\_active \= FALSE,

        sold\_at \= NOW()

    WHERE is\_active \= TRUE

      AND last\_seen\_at \< (

          SELECT started\_at FROM scrape\_runs WHERE id \= target\_run\_id

      );

    GET DIAGNOSTICS updated\_count \= ROW\_COUNT;

    RETURN updated\_count;

END;

$$;

**scripts/scrape\_details.py**

Rewrite to be incremental. At start, fetch the list of listings to scrape:

result \= supabase.rpc("listings\_needing\_detail\_scrape").execute()

todo \= result.data  \# List of {listing\_id, listing\_url, reason}

Keep the parallel-workers logic from the local version (3 workers, 2 sec delay, 429 backoff). After steady state, this should be only \~50-200 listings per weekly run instead of 6,000.

On each successful detail scrape, UPDATE the listings row with the rich fields and append a row to listings\_history.

**scripts/download\_images.py**

Rewrite for Supabase Storage:

\# Get listings needing images

result \= supabase.rpc("listings\_needing\_image\_download").execute()

for listing in result.data:

    \# Download from MorphMarket CDN (same as local version)

    bytes \= requests.get(listing\["primary\_image\_url"\], headers=...).content

    

    \# Upload to Supabase Storage

    path \= f"{listing\['listing\_id'\]}.jpg"

    supabase.storage.from\_("listing-images").upload(path, bytes)

    

    \# Update listings row with the Supabase Storage URL

    new\_url \= f"{SUPABASE\_URL}/storage/v1/object/public/listing-images/{path}"

    supabase.table("listings").update({

        "primary\_image\_url": new\_url

    }).eq("listing\_id", listing\["listing\_id"\]).execute()

Create the `listing-images` storage bucket if it doesn't exist. Make it public (these are already public-facing thumbnails on MorphMarket).

**scripts/transform\_and\_load.py**

Common utilities the three scrapers share:

- Parse weight strings to grams (`"25g"` \-\> 25.0)  
- Split pipe-separated traits into arrays  
- Numeric coercion with fallback to None

Copy these helpers from the local `migrate_to_supabase.py`.

### Task 6: One-time bulk upload of local images

Tennyson has \~5,849 primary images already downloaded locally in `~/Desktop/geckscrape/images/`. To save time and bandwidth, write a one-time helper script `scripts/upload_local_images.py` that:

1. Reads all files in `~/Desktop/geckscrape/images/`  
2. For each, uploads to Supabase Storage `listing-images` bucket  
3. Updates the corresponding `listings.primary_image_url`

Run this LOCALLY (not via GitHub Actions) since the files are on his Mac.

### Task 7: GitHub Actions workflows

Three workflow files in `.github/workflows/`:

**scrape-listings-daily.yml**

name: Daily Listings Scrape

on:

  schedule:

    \- cron: '0 9 \* \* \*'    \# 9 AM UTC daily

  workflow\_dispatch:

jobs:

  scrape:

    runs-on: ubuntu-latest

    timeout-minutes: 60

    steps:

      \- uses: actions/checkout@v4

      \- uses: actions/setup-python@v5

        with:

          python-version: '3.11'

      \- run: pip install \-r scripts/requirements.txt

      \- run: python scripts/scrape\_listings.py

        env:

          DECODO\_AUTH: ${{ secrets.DECODO\_AUTH }}

          SUPABASE\_URL: ${{ secrets.SUPABASE\_URL }}

          SUPABASE\_SERVICE\_KEY: ${{ secrets.SUPABASE\_SERVICE\_KEY }}

          TRIGGERED\_BY: github\_action

**scrape-details-weekly.yml**

Same structure. Cron `0 10 * * 1` (Mondays 10 AM UTC). timeout 240 minutes. Calls `scrape_details.py`.

**scrape-images-weekly.yml**

Same. Cron `0 11 * * 1` (Mondays 11 AM UTC). timeout 60 minutes. Calls `download_images.py`.

**CRITICAL:** Comment out the `schedule:` section initially. Only enable cron after Tennyson has manually triggered each workflow via workflow\_dispatch and verified it works. Otherwise a misconfigured workflow burns Decodo credits at 9 AM every day.

Required GitHub secrets (Settings \> Secrets and variables \> Actions):

- `DECODO_AUTH` (Basic auth string, full value including "Basic " prefix)  
- `SUPABASE_URL` (the geck-data project URL)  
- `SUPABASE_SERVICE_KEY` (the geck-data service role secret, not anon key)

### Task 8: Auth \+ admin gating

In `lib/supabase.ts` set up the server-side Supabase client. In `lib/supabase-browser.ts` set up the browser one.

`app/login/page.tsx`: Standard Supabase Auth UI. Email/password login.

`app/admin/layout.tsx`: server component that checks:

const { data: { user } } \= await supabase.auth.getUser()

if (\!user || user.id \!== process.env.ADMIN\_USER\_ID) {

    redirect('/login')

}

Tell Tennyson he needs to:

1. Sign up at his own deployed URL (creates his Supabase Auth user)  
2. Copy his user ID from Supabase Dashboard \> Authentication \> Users  
3. Paste it as `ADMIN_USER_ID` in Vercel env vars

### Task 9: Admin pages

V1 should be ugly and functional. Polish later.

**app/admin/page.tsx** \- Admin home:

Header stats (4 cards):

- Active listings count (from `listings WHERE is_active`)  
- Average asking price (active only)  
- Unique sellers count  
- Most recent scrape (type \+ timestamp \+ status)

Below: last 10 scrape\_runs in a table.

Below: "Run scrape" section with three buttons \- one per scrape type. Each button POSTs to `/api/trigger-scrape` with the workflow name.

**app/admin/listings/page.tsx** \- Listings browser:

Server-rendered, paginated (50 per page). Sortable. Columns: thumbnail, name, price, sex, weight, traits, seller, first\_seen, last\_seen.

Click row \-\> show full JSON in a drawer/modal.

**app/admin/morphs/page.tsx** \- Morphs breakdown:

Read `morph_price_stats` view. Table sorted by listing\_count desc.

**app/admin/sellers/page.tsx** \- Sellers breakdown:

Read `seller_stats` view. Table sorted by active\_listings desc.

**app/admin/runs/page.tsx** \- Scrape run history:

All scrape\_runs paginated, with status colors, durations, counts.

### Task 10: API route for triggering scrapes

`app/api/trigger-scrape/route.ts`:

export async function POST(req: Request) {

    // Verify the calling user is the admin

    const supabase \= createServerClient(...)

    const { data: { user } } \= await supabase.auth.getUser()

    if (\!user || user.id \!== process.env.ADMIN\_USER\_ID) {

        return new Response('Forbidden', { status: 403 })

    }

    

    const { workflow } \= await req.json()

    // workflow is 'scrape-listings-daily.yml' etc

    

    const response \= await fetch(

        \`https://api.github.com/repos/${process.env.GITHUB\_REPO}/actions/workflows/${workflow}/dispatches\`,

        {

            method: 'POST',

            headers: {

                'Authorization': \`Bearer ${process.env.GITHUB\_PAT}\`,

                'Accept': 'application/vnd.github+json',

            },

            body: JSON.stringify({ ref: 'main' }),

        }

    )

    

    return Response.json({ success: response.ok })

}

GITHUB\_PAT needs `actions:write` scope. Tell Tennyson how to generate one in GitHub \> Settings \> Developer settings \> Personal access tokens \> Fine-grained.

### Task 11: Vercel deployment

Set up:

- Connect repo to Vercel  
- Add all env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `ADMIN_USER_ID`, `GITHUB_PAT`, `GITHUB_REPO`)  
- Deploy

Ask Tennyson about the domain:

- `data.geckinspect.com` (subdomain)  
- New domain like `geckmarket.com`  
- Just `geck-data.vercel.app` for now

DON'T pick for him.

### Task 12: README and onboarding doc

Write `README.md` in plain language for non-developers explaining:

- What this project does  
- The three scheduled jobs and when they run  
- How to manually trigger a scrape from the admin UI  
- How to add new env vars if anything changes  
- Common troubleshooting (Decodo rate limited, GitHub Action failed, etc.)

Write `scripts/README.md` with similar content for the Python side \- how to run locally, what each script does, common errors.

---

## Order of operations

1. Inspect existing repo state (Task 1\)  
2. Adapt structure / install deps (Tasks 2-4)  
3. Move and rewrite scrapers (Task 5\)  
4. One-time image bulk upload (Task 6\) \- run LOCALLY before anything else  
5. Test each script locally with .env credentials \- verify Supabase updates  
6. GitHub Actions, schedules COMMENTED OUT (Task 7\) \- manual trigger only first  
7. Auth \+ admin gate (Task 8\)  
8. Admin pages (Task 9\)  
9. API route for triggering (Task 10\)  
10. Vercel deploy (Task 11\)  
11. Verify end-to-end: log in, view admin, click trigger button, see GH Actions run, see new data in Supabase  
12. Enable cron schedules  
13. README docs (Task 12\)

---

## Things Tennyson cares about, in priority order

1. **Don't break what's working.** The local CSV pipeline is his backup. Don't touch it.  
     
2. **Resumability.** Every script should be safe to run multiple times. UPSERT, not INSERT. Skip already-done work.  
     
3. **Observability.** He should be able to look at the admin UI and understand what's happening, when, and whether it succeeded.  
     
4. **Cost discipline.** Decodo is $19/mo. Incremental scraping must work correctly or he burns through it. Test the incremental logic carefully.  
     
5. **The ML training use case.** Eventually a separate script will read `SELECT * FROM listings` plus images to train a morph ID classifier. Keep the data clean enough for that.

---

## Communication style

- Walk through your plan before you execute  
- After each major task, summarize what changed  
- If you discover something Tennyson didn't anticipate, stop and ask  
- Don't dump big code blocks at him without context \- explain what each piece does

Good luck. Build something he can be proud of.  
