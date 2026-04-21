-- ============================================================================
-- Geck Inspect — 0002: extension streams
--
-- Adds the tables the browser extension needs to stream live events into,
-- beyond the batch .db import covered by 0001. Every table is
--   a) an append-only observation log (price_history, listing_status_events,
--      seller_snapshots, show_mentions, auction_results, price_drops,
--      alert_matches) — or
--   b) an upsert-on-external-key store (cross_platform_listings, alerts).
--
-- Also extends market_listings with first_seen_at / last_seen_at so we can
-- compute days-to-sell and listing age without a separate join.
--
-- Safe to re-run. Everything uses IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. market_listings extensions
-- ----------------------------------------------------------------------------
alter table public.market_listings
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at  timestamptz,
  add column if not exists current_status text
    check (current_status in ('live','sold','hold','removed','returned')) ;

create index if not exists idx_market_listings_last_seen_at
  on public.market_listings(last_seen_at desc);
create index if not exists idx_market_listings_current_status
  on public.market_listings(current_status);

-- ----------------------------------------------------------------------------
-- 1. price_history — every observed price for a listing
-- ----------------------------------------------------------------------------
create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.market_listings(id) on delete cascade,
  price numeric,
  price_usd_equivalent numeric,
  currency text,
  observed_at timestamptz not null default now(),
  source text
);

create index if not exists idx_price_history_listing_observed
  on public.price_history(listing_id, observed_at desc);

-- ----------------------------------------------------------------------------
-- 2. price_drops — explicit drop deltas (faster than window-fn over history)
-- ----------------------------------------------------------------------------
create table if not exists public.price_drops (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.market_listings(id) on delete cascade,
  old_price numeric,
  new_price numeric,
  old_price_usd numeric,
  new_price_usd numeric,
  currency text,
  pct_change numeric,
  observed_at timestamptz not null default now(),
  source text
);

create index if not exists idx_price_drops_listing
  on public.price_drops(listing_id);
create index if not exists idx_price_drops_observed_at
  on public.price_drops(observed_at desc);

-- ----------------------------------------------------------------------------
-- 3. listing_status_events — state transitions (live / sold / hold / removed)
-- ----------------------------------------------------------------------------
create table if not exists public.listing_status_events (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.market_listings(id) on delete cascade,
  status text not null check (status in ('live','sold','hold','removed','returned')),
  observed_at timestamptz not null default now(),
  source text, -- 'extension_explicit' | 'extension_inferred' | 'db_import' | 'auction_close'
  days_since_first_seen int,
  unique (listing_id, status, observed_at)
);

create index if not exists idx_listing_status_events_listing
  on public.listing_status_events(listing_id);
create index if not exists idx_listing_status_events_status_observed
  on public.listing_status_events(status, observed_at desc);

-- ----------------------------------------------------------------------------
-- 4. auction_results — when an auction closes, capture the final state
-- ----------------------------------------------------------------------------
create table if not exists public.auction_results (
  id uuid primary key default gen_random_uuid(),
  listing_id text references public.market_listings(id) on delete set null,
  final_price numeric,
  final_price_usd numeric,
  currency text,
  bid_count int,
  winning_bidder text,
  closed_at timestamptz not null default now(),
  observed_at timestamptz not null default now(),
  source text
);

create index if not exists idx_auction_results_closed_at
  on public.auction_results(closed_at desc);
create index if not exists idx_auction_results_listing
  on public.auction_results(listing_id);

-- ----------------------------------------------------------------------------
-- 5. seller_snapshots — periodic capture of seller-level stats
-- ----------------------------------------------------------------------------
create table if not exists public.seller_snapshots (
  id uuid primary key default gen_random_uuid(),
  seller_id text not null references public.market_sellers(seller_id) on delete cascade,
  observed_at timestamptz not null default now(),
  feedback_count int,
  seller_rating_score numeric,
  five_star_rating numeric,
  total_listings int,
  avg_price numeric,
  membership text,
  source text
);

create index if not exists idx_seller_snapshots_seller_observed
  on public.seller_snapshots(seller_id, observed_at desc);

-- ----------------------------------------------------------------------------
-- 6. show_mentions — expo / show references found on listings or in bios
-- ----------------------------------------------------------------------------
create table if not exists public.show_mentions (
  id uuid primary key default gen_random_uuid(),
  listing_id text references public.market_listings(id) on delete set null,
  seller_id text references public.market_sellers(seller_id) on delete set null,
  show_name text not null,
  show_date date,
  context text,                           -- surrounding sentence
  source_url text,
  observed_at timestamptz not null default now()
);

create index if not exists idx_show_mentions_show_name
  on public.show_mentions(show_name);
create index if not exists idx_show_mentions_observed_at
  on public.show_mentions(observed_at desc);

-- ----------------------------------------------------------------------------
-- 7. cross_platform_listings — listings observed on Fauna Classifieds,
--    Reptile Forums, Preloved, Kijiji, etc. — keyed by (platform, external_id).
-- ----------------------------------------------------------------------------
create table if not exists public.cross_platform_listings (
  id uuid primary key default gen_random_uuid(),
  platform text not null,                 -- 'fauna_classifieds' | 'reptile_forums' | 'preloved' | 'kijiji' | …
  external_id text not null,
  title text,
  description text,
  price numeric,
  price_usd_equivalent numeric,
  currency text,
  seller_name text,
  seller_location text,
  url text,
  traits_raw text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  payload jsonb,
  unique (platform, external_id)
);

create index if not exists idx_cross_platform_platform
  on public.cross_platform_listings(platform);
create index if not exists idx_cross_platform_last_seen_at
  on public.cross_platform_listings(last_seen_at desc);

-- ----------------------------------------------------------------------------
-- 8. alerts + alert_matches — saved queries and their hits
-- ----------------------------------------------------------------------------
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  query jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_alerts_owner on public.alerts(owner_id);

create table if not exists public.alert_matches (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts(id) on delete cascade,
  listing_id text references public.market_listings(id) on delete set null,
  cross_platform_listing_id uuid references public.cross_platform_listings(id) on delete set null,
  matched_at timestamptz not null default now(),
  payload jsonb,
  -- at least one side of the match must be populated
  check (listing_id is not null or cross_platform_listing_id is not null)
);

create index if not exists idx_alert_matches_alert on public.alert_matches(alert_id);
create index if not exists idx_alert_matches_matched_at on public.alert_matches(matched_at desc);

-- ----------------------------------------------------------------------------
-- 9. RLS — public read (reads via anon key, writes via service role only)
-- ----------------------------------------------------------------------------
alter table public.price_history            enable row level security;
alter table public.price_drops              enable row level security;
alter table public.listing_status_events    enable row level security;
alter table public.auction_results          enable row level security;
alter table public.seller_snapshots         enable row level security;
alter table public.show_mentions            enable row level security;
alter table public.cross_platform_listings  enable row level security;
alter table public.alerts                   enable row level security;
alter table public.alert_matches            enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'price_history','price_drops','listing_status_events','auction_results',
    'seller_snapshots','show_mentions','cross_platform_listings','alert_matches'
  ]) loop
    execute format('drop policy if exists "public read %I" on public.%I', t, t);
    execute format('create policy "public read %I" on public.%I for select using (true)', t, t);
  end loop;
end $$;

-- alerts: owner-scoped read/write (personal saved queries)
drop policy if exists "owner read alerts" on public.alerts;
create policy "owner read alerts" on public.alerts
  for select using (auth.uid() = owner_id);

drop policy if exists "owner insert alerts" on public.alerts;
create policy "owner insert alerts" on public.alerts
  for insert with check (auth.uid() = owner_id);

drop policy if exists "owner update alerts" on public.alerts;
create policy "owner update alerts" on public.alerts
  for update using (auth.uid() = owner_id);

drop policy if exists "owner delete alerts" on public.alerts;
create policy "owner delete alerts" on public.alerts
  for delete using (auth.uid() = owner_id);

-- ----------------------------------------------------------------------------
-- 10. Convenience view: sold listings with days_to_sell
-- ----------------------------------------------------------------------------
create or replace view public.sold_listings_v as
select
  l.id,
  l.seller_id,
  l.title,
  l.price,
  l.price_usd_equivalent,
  l.maturity,
  l.sex,
  l.cached_traits,
  l.norm_traits,
  l.first_seen_at,
  lse.observed_at as sold_at,
  lse.days_since_first_seen as days_to_sell,
  lse.source as sold_source
from public.market_listings l
join public.listing_status_events lse on lse.listing_id = l.id
where lse.status = 'sold';
