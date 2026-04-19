-- ============================================================================
-- Geck Data — extension ingest additions
--
-- Lets the Chrome extension POST captured JSON straight into Supabase via
-- /api/ingest. Adds:
--   1) A permissive schema for market_listings / market_sellers so either a
--      pre-existing table (from the Python upload path) or a fresh one works.
--   2) `raw` jsonb + `kind` + `updated_at` columns on market_listings.
--   3) `raw` jsonb + `updated_at` columns on market_sellers.
--   4) An `ingest_events` audit log the ingest route writes to.
--
-- Paste into Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Every statement is idempotent; safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Base tables (created only if missing; does not touch existing columns)
-- ----------------------------------------------------------------------------
create table if not exists public.market_listings (
  id text primary key
);

create table if not exists public.market_sellers (
  seller_id text primary key
);

-- ----------------------------------------------------------------------------
-- 2. Extension-ingest columns on market_listings
-- ----------------------------------------------------------------------------
alter table public.market_listings
  add column if not exists kind text,
  add column if not exists raw jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_market_listings_kind
  on public.market_listings(kind);

create index if not exists idx_market_listings_updated_at
  on public.market_listings(updated_at desc);

-- ----------------------------------------------------------------------------
-- 3. Extension-ingest columns on market_sellers
-- ----------------------------------------------------------------------------
alter table public.market_sellers
  add column if not exists raw jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_market_sellers_updated_at
  on public.market_sellers(updated_at desc);

-- ----------------------------------------------------------------------------
-- 4. ingest_events audit log
-- ----------------------------------------------------------------------------
create table if not exists public.ingest_events (
  id bigserial primary key,
  kind text not null,
  source text,
  received integer not null default 0,
  written integer not null default 0,
  skipped integer not null default 0,
  errors jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ingest_events_created_at
  on public.ingest_events(created_at desc);

alter table public.ingest_events enable row level security;
-- No public policies — only the service role writes/reads this table.
