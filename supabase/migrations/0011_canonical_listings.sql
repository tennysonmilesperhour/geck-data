-- ============================================================================
-- 0011 — Track the scrape pipeline schema + mark canonical-source rows
--
-- Background: the geck-data scrape pipeline writes to three tables that were
-- created outside this repo's migrations folder (originally via SQL Editor
-- when the pipeline shipped in PR #48):
--
--   - public.listings           (scraper output, PK listing_id)
--   - public.listings_history   (one row per observation, FK to scrape_runs)
--   - public.scrape_runs        (one row per pipeline run)
--
-- This migration brings them into the tracked migrations folder with
-- CREATE TABLE IF NOT EXISTS so a future fresh-install rebuilds correctly,
-- and adds two things needed for the canonical dual-write that lets the
-- public web app see scraper-sourced rows via market_listings:
--
--   1. An index on market_listings.source so the dashboard can filter by
--      provenance ('scraper' vs 'extension_legacy' vs 'manual').
--   2. A non-unique index on market_listings.morphmarket_key so cross-table
--      lookups by numeric MorphMarket id (used by the backfill dedupe step)
--      are not full scans.
--
-- Safe to re-run; IF NOT EXISTS / IF NOT EXISTS everywhere.
-- Paste into Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. scrape_runs
--    One row per Decodo scrape, CSV migration, or canonical backfill. Used by
--    /data-admin/runs and as the FK target for listings_history.
-- ----------------------------------------------------------------------------
create table if not exists public.scrape_runs (
  id bigserial primary key,
  scrape_type text not null,
  status text not null default 'running',
  triggered_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_attempted int not null default 0,
  records_succeeded int not null default 0,
  records_failed int not null default 0,
  error_message text
);

create index if not exists idx_scrape_runs_started_at
  on public.scrape_runs(started_at desc);

create index if not exists idx_scrape_runs_scrape_type_status
  on public.scrape_runs(scrape_type, status);

-- ----------------------------------------------------------------------------
-- 2. listings
--    Source of truth for scraper output. Read by /data-admin/* and by the
--    canonical dual-write mirror that populates market_listings.
-- ----------------------------------------------------------------------------
create table if not exists public.listings (
  listing_id text primary key,
  name text,
  price numeric,
  currency text,
  seller_name text,
  sex text,
  weight text,
  weight_grams numeric,
  maturity text,
  scientific_name text,
  birth_date text,
  origin text,
  pet_only text,
  lineage text,
  traits text,
  trait_array text[],
  trait_count int,
  category text,
  description text,
  primary_image_url text,
  all_image_urls text[],
  image_count int,
  listing_url text not null default '',
  availability text,
  shipping_label text,
  shipping_rate numeric,
  shipping_currency text,
  payment_method text,
  sku text,
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sold_at timestamptz,
  species text default 'crested-gecko'
);

create index if not exists idx_listings_last_seen_at
  on public.listings(last_seen_at desc);

create index if not exists idx_listings_is_active
  on public.listings(is_active) where is_active = true;

create index if not exists idx_listings_seller_name
  on public.listings(seller_name);

-- ----------------------------------------------------------------------------
-- 3. listings_history
--    Append-only observation log. Every scrape run inserts one row per
--    listing it sees with raw_snapshot capturing the source-of-truth payload.
-- ----------------------------------------------------------------------------
create table if not exists public.listings_history (
  id bigserial primary key,
  listing_id text not null references public.listings(listing_id) on delete cascade,
  scrape_run_id bigint references public.scrape_runs(id) on delete set null,
  observed_at timestamptz not null default now(),
  price numeric,
  is_active boolean,
  raw_snapshot jsonb
);

create index if not exists idx_listings_history_listing_observed
  on public.listings_history(listing_id, observed_at desc);

create index if not exists idx_listings_history_scrape_run
  on public.listings_history(scrape_run_id);

-- ----------------------------------------------------------------------------
-- 4. market_listings source-provenance index
--    The canonical dual-write tags rows with source='scraper'. The Eye in
--    the Sky bulk Python upload used source='manual' or NULL; the extension
--    real-time stream uses source='extension'. Filtering by source is now
--    common enough in /data-admin and future client tools that it warrants
--    a partial index.
-- ----------------------------------------------------------------------------
create index if not exists idx_market_listings_source
  on public.market_listings(source);

create index if not exists idx_market_listings_morphmarket_key
  on public.market_listings(morphmarket_key);

-- ----------------------------------------------------------------------------
-- 5. RLS on the scraper tables
--    /data-admin reads with the anon key (no auth on those pages today),
--    so we grant public SELECT to keep the dashboard working. Writes only
--    happen through the service-role-keyed Python scripts and the
--    GitHub Action, both of which bypass RLS.
-- ----------------------------------------------------------------------------
alter table public.listings         enable row level security;
alter table public.listings_history enable row level security;
alter table public.scrape_runs      enable row level security;

drop policy if exists "public read listings"         on public.listings;
create policy "public read listings"         on public.listings         for select using (true);

drop policy if exists "public read listings_history" on public.listings_history;
create policy "public read listings_history" on public.listings_history for select using (true);

drop policy if exists "public read scrape_runs"      on public.scrape_runs;
create policy "public read scrape_runs"      on public.scrape_runs      for select using (true);
