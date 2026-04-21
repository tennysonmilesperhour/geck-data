-- ============================================================================
-- Geck Data — 0002a: ingest metadata
--
-- Additive follow-up to 0002_extension_streams. Introduces the minimal schema
-- the salvaged artifacts from PR #1 need to be useful on current main:
--
--   1) market_listings.kind / .raw / .updated_at
--      Populated opportunistically by future ingest patches. The training
--      views in 0003_training_dataset flatten .raw into (image_url, traits[])
--      pairs, and /api/stats filters counts by .kind.
--
--   2) market_sellers.raw / .updated_at
--      Same idea on the sellers side.
--
--   3) ingest_events audit log.
--      Read by /api/stats (last event timestamp). Currently no writer on main
--      — the table is there so the stats endpoint can read from it without
--      500'ing; rows will start appearing when /api/ingest is wired to append
--      here in a follow-up.
--
-- Numbered 0002a so it sorts AFTER 0002_extension_streams and BEFORE
-- 0003_admin_analytics / 0003_training_dataset, which depend on its columns.
--
-- Fully idempotent — safe to re-run. Paste into Supabase Dashboard → SQL
-- Editor → New query → Run, or apply via `supabase db push`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. market_listings: ingest metadata
-- ----------------------------------------------------------------------------
alter table public.market_listings
  add column if not exists kind       text,
  add column if not exists raw        jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_market_listings_kind
  on public.market_listings(kind);

create index if not exists idx_market_listings_updated_at
  on public.market_listings(updated_at desc);

-- ----------------------------------------------------------------------------
-- 2. market_sellers: ingest metadata
-- ----------------------------------------------------------------------------
alter table public.market_sellers
  add column if not exists raw        jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_market_sellers_updated_at
  on public.market_sellers(updated_at desc);

-- ----------------------------------------------------------------------------
-- 3. ingest_events audit log
-- ----------------------------------------------------------------------------
create table if not exists public.ingest_events (
  id         bigserial primary key,
  kind       text not null,
  source     text,
  received   integer not null default 0,
  written    integer not null default 0,
  skipped    integer not null default 0,
  errors     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ingest_events_created_at
  on public.ingest_events(created_at desc);

alter table public.ingest_events enable row level security;
-- No public policies — the service role writes/reads; everyone else gets nothing.
