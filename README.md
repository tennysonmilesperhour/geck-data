# Geck Inspect — v1 MVP

A web dashboard for crested gecko market intelligence. Reads from your Supabase
project, renders three D3 charts, and gives you (the logged-in user) a drop zone
for new database files, images, and CSVs.

> **Stack:** Next.js 14 (App Router) · TypeScript · Tailwind · D3.js · Supabase
> (Auth, Postgres, Storage) · deployed on Vercel.

---

## What's in this repo

```
geck-inspect/
├── README.md                              ← you are here
├── package.json                           ← dependencies + scripts
├── next.config.mjs, tsconfig.json, tailwind.config.ts, postcss.config.js
├── .env.local.example                     ← copy to .env.local and fill in
├── supabase/
│   └── migrations/0001_init_geck_inspect.sql   ← run in Supabase SQL editor
└── src/
    ├── middleware.ts                      ← gates /upload to logged-in users
    ├── app/
    │   ├── layout.tsx, globals.css
    │   ├── page.tsx                       ← public dashboard
    │   ├── login/page.tsx                 ← email/password sign-in
    │   ├── upload/page.tsx                ← drop zone (logged-in only)
    │   ├── api/upload/route.ts            ← browser drop-zone → server ingest (session auth)
    │   └── api/ingest/route.ts            ← machine-to-machine ingest (Bearer INGEST_API_KEY)
    ├── components/
    │   ├── Header.tsx, LogoutButton.tsx
    │   ├── DropZone.tsx
    │   └── charts/
    │       ├── PriceHistogram.tsx
    │       ├── TraitFrequencyAndPrice.tsx
    │       └── SellerLeaderboardScatter.tsx
    └── lib/
        ├── supabase/{client,server,admin}.ts
        └── ingest/parseSqlite.ts          ← sql.js wrapper + batched upsert
```

---

## Setup checklist (first time)

You'll do these once, in order.

### 1. Run the SQL migration in Supabase

1. Open https://supabase.com/dashboard → your project → **SQL Editor**.
2. Click **New query**.
3. Paste the contents of `supabase/migrations/0001_init_geck_inspect.sql`.
4. Click **Run**. You should see "Success. No rows returned."

What this does: creates the `listing_images` table, the two storage buckets,
and the row-level-security policies so the dashboard can read your data.

### 2. Get your Supabase keys

In the same dashboard:

1. Click the **gear icon** (Project Settings) → **API**.
2. Copy two values:
   - **Project URL** (looks like `https://dhotmtgryuovkmsncdby.supabase.co`)
   - **anon / public** key (the long `eyJ…` one labeled "anon public")
   - **service_role** key (the second `eyJ…`, labeled "service_role" — **secret**)

### 3. Install Node.js (if you don't already have it)

Open Terminal and run:

```bash
node --version
```

If it prints something like `v20.something`, you're good. Otherwise install it
from https://nodejs.org (pick the **LTS** version — currently 20.x).

### 4. Install dependencies

In the project folder:

```bash
cd ~/projects/geck-inspect
npm install
```

This will take a minute or two. It pulls down React, Next.js, D3, Supabase
client, etc. — about 300 MB of `node_modules/`.

### 5. Create `.env.local`

```bash
cp .env.local.example .env.local
```

Now open `.env.local` in any text editor and replace the placeholder values
with the keys you copied in step 2.

### 6. Run it locally

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

- The dashboard should load with your 1,105 listings and 214 sellers.
- Click **Log in** → **Create account** → enter an email + password.
- Now click **Upload** to see the drop zone.

---

## Day-to-day use

- **Refresh data:** drag a fresh `morphmarket_test.db` (or whatever your
  scraper outputs) onto the drop zone. The dashboard auto-refreshes the next
  time you load it.
- **Add images:** drop them onto the upload zone. If the filename includes a
  MorphMarket id (e.g. `mm_3631595.jpg`), it auto-links to that listing.
- **Archive CSVs:** drop them — they're saved to the `raw-uploads` bucket for
  later processing.

---

## Deploy to Vercel

### One-time setup

1. Push this repo to GitHub:
   ```bash
   cd ~/projects/geck-inspect
   git init
   git add .
   git commit -m "Initial v1"
   git remote add origin https://github.com/tennysonmilesperhour/geck-inspect.git
   git push -u origin main
   ```
   (Create the empty repo on GitHub first.)

2. Go to https://vercel.com/new → import the repo.
3. **Framework Preset:** Next.js (auto-detected).
4. **Environment Variables:** add the same three keys from your `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Click **Deploy**. ~2 minutes later you'll have a live URL like
   `https://geck-inspect.vercel.app`.

### Subsequent deploys

`git push` to `main` → Vercel auto-deploys. That's it.

---

## How the pieces fit together

```
                          ┌───────────────────────┐
   browser                │  market_listings      │
   ┌────────────────┐     │  market_sellers       │
   │  /  dashboard  │────▶│  listing_images       │
   │  (D3 charts)   │     │  (Supabase Postgres)  │
   └────────────────┘     └───────────────────────┘
                                    ▲
                                    │ upserts (service role)
                                    │
   ┌────────────────┐     ┌───────────────────────┐
   │  /upload       │────▶│  /api/upload          │
   │  (drop zone)   │     │  parses .db with      │
   └────────────────┘     │  sql.js, routes       │
       ▲                  │  images→Storage       │
       │ session cookie   │  csv→Storage          │
       │                  └───────────────────────┘
   ┌───┴────────────┐                ▲
   │  middleware.ts │  blocks unauth │
   └────────────────┘                │
                                     │ uploads
                          ┌──────────┴────────────┐
                          │  listing-images       │
                          │  raw-uploads          │
                          │  (Supabase Storage)   │
                          └───────────────────────┘
```

---

## Troubleshooting

**"Could not load data from Supabase" on the dashboard**
The migration didn't run, or the env vars are wrong. Re-check step 1 and step 5.

**`npm run dev` errors about missing modules**
You skipped `npm install`. Run it.

**Upload of a `.db` file hangs or times out**
sql.js loads its WASM from a CDN on first use — first parse can be slow. If it
takes more than 60s, the Vercel serverless route will time out. For very large
DBs, fall back to the Python `upload_to_supabase.py` script we built earlier.

**Login says "Email not confirmed"**
By default Supabase requires email confirmation. Either confirm the link they
emailed you, or in the Supabase dashboard go to **Authentication → Providers →
Email** and toggle off "Confirm email" for development.

---

## Extension event stream (v2)

Alongside bulk `.db` uploads, the browser extension pushes live JSON events to
`/api/ingest` as it captures data while you browse MorphMarket and other
platforms. The API branches on `Content-Type`:

```
POST /api/ingest
Authorization: Bearer <INGEST_API_KEY>
Content-Type: application/json

{ "events": [
  { "type": "listingSeen",      "payload": { …listing… } },
  { "type": "priceDrop",        "payload": { listing_id, old_price, new_price } },
  { "type": "soldInferred",     "payload": { listing_id } },
  { "type": "auctionClose",     "payload": { listing_id, final_price, bid_count, closed_at } },
  { "type": "showMention",      "payload": { show_name, show_date, context, source_url } },
  { "type": "sellerSnapshot",   "payload": { seller_id, feedback_count, total_listings, … } },
  { "type": "crossPlatform",    "payload": { platform, external_id, title, price, … } },
  { "type": "alertMatch",       "payload": { alert_id, listing_id | cross_platform_listing_id } },
  { "type": "searchResultBatch","payload": { listings: [ … ] } }
]}
```

Schema for the tables each event writes to lives in
`supabase/migrations/0002_extension_streams.sql`. Run it once in the Supabase
SQL Editor — safe to re-run.

## Analytics routes

| Route | What it shows |
|---|---|
| `/` | Market pulse — past-7d KPIs + three charts |
| `/sold` | Sold listings with days-to-sell histogram |
| `/price-drops` | Every drop the extension captured |
| `/sellers` | Seller leaderboard + table |
| `/sellers/[id]` | One seller's timeline, inventory, recent sales |
| `/shows` | Expo/show mention aggregation |
| `/cross-platform` | Listings from Fauna Classifieds, Reptile Forums, Preloved, Kijiji |
| `/alerts` | Your saved queries and their matches (login required) |
| `/admin/analytics` | **Admin only** — Growth / Engagement / Features / Retention / Errors |

## Admin analytics (`/admin/analytics`)

A five-tab dashboard at `/admin/analytics`, gated to users with
`profiles.role = 'admin'`. Structure mirrors the companion app's Analytics
page so patterns stay consistent across the stack:

- **Growth** — new signups, new listings, price drops, sold, cross-platform,
  show mentions. Every KPI compares the selected period to the prior period
  of equal length and shows the raw prior count next to the delta.
- **Engagement** — DAU from `user_events`, sessions, return rate, top pages
  (events + distinct sessions per page).
- **Features** — `page_view` vs feature events, top event names, full
  breakdown table with **count + unique-user reach** per event name.
- **Retention** — weekly cohort grid (last 8 signup weeks × W+1..W+4
  follow-up weeks). Incomplete weeks render `—`; cell color saturates at 60%.
- **Errors** — `error_logs` viewer with period/level/search filters and a
  detail modal (mark resolved, delete).

### Telemetry

`src/lib/telemetry.ts` exposes four entry points, all safe to call from
anywhere on the client:

```ts
import {
  trackEvent,
  trackPageView,
  reportError,
  installGlobalErrorHandlers,
} from "@/lib/telemetry";

trackEvent("upload_started", { filename, bytes });
trackEvent("alert_created", { query_type: "maturity" });
```

Page views are already captured automatically on every route change via
`src/components/TelemetryClient.tsx`. `installGlobalErrorHandlers()` is
invoked once at mount and routes uncaught `window.error` + unhandled promise
rejections into `public.error_logs`; `src/components/ErrorBoundary.tsx` adds
the React render-time pipeline.

Every event row carries a `source` column (currently `'geck-inspect'`) so
future inspectors / scrapers / the browser extension can write into the
same tables via the Supabase REST API and stay distinguishable in the
dashboard.

### Enabling it

1. Run `supabase/migrations/0003_admin_analytics.sql` (creates `profiles`,
   `user_events`, `error_logs`, indexes, RLS, and the `v_daily_activity`
   view — see `README_admin_analytics_prod.md` for details).
2. Promote yourself to admin once, in the Supabase SQL editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
3. Reload the app; an **Analytics** tab appears in the header and
   `/admin/analytics` unlocks.

## Next up (v3 ideas)

- Geographic map of sellers (D3 + TopoJSON US states).
- Image gallery on the dashboard, filterable by trait.
- Trait combo box plots.
- Pedigree premium chart (proven_breeder vs not).
- In-UI alert creation / editing (currently insert directly into `alerts`).
- CSV parsing in `/api/upload` — route to the right staging table by filename
  prefix.
