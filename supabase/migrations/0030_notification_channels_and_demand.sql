-- ============================================================================
-- Geck Data 0030: notification channels + demand-signal event tables.
--
-- 1. user_notification_channels: where alert matches get pushed (Discord
--    webhook, generic webhook, email digest). Owner-scoped RLS so users
--    only see their own destinations. /api/ingest reads with the service
--    role so write/read symmetry isn't required.
--
-- 2. listing_views / listing_favorites: demand-side signals from the
--    extension. Until now we only knew what got listed; these tables
--    record what users *look at*. A future v_demand_index view will pair
--    views with listing_status_events to compute a demand-side velocity.
--
-- Both feature areas are additive; nothing existing depends on them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. user_notification_channels
-- ----------------------------------------------------------------------------
create table if not exists public.user_notification_channels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('discord_webhook','generic_webhook','email')),
  endpoint text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  -- Allow at most a handful of endpoints per kind per user to bound the
  -- fan-out cost of a single match.
  unique (owner_id, kind, endpoint)
);

create index if not exists idx_unc_owner on public.user_notification_channels(owner_id);
create index if not exists idx_unc_enabled on public.user_notification_channels(enabled);

alter table public.user_notification_channels enable row level security;
drop policy if exists "owner read channels"   on public.user_notification_channels;
drop policy if exists "owner insert channels" on public.user_notification_channels;
drop policy if exists "owner update channels" on public.user_notification_channels;
drop policy if exists "owner delete channels" on public.user_notification_channels;

create policy "owner read channels" on public.user_notification_channels
  for select using (auth.uid() = owner_id);
create policy "owner insert channels" on public.user_notification_channels
  for insert with check (auth.uid() = owner_id);
create policy "owner update channels" on public.user_notification_channels
  for update using (auth.uid() = owner_id);
create policy "owner delete channels" on public.user_notification_channels
  for delete using (auth.uid() = owner_id);

-- ----------------------------------------------------------------------------
-- 2. Demand-signal tables.
--
--    listing_views: anonymous, one row per (listing_id, anon_hash, day).
--    The extension generates a stable but anonymous hash per browser so
--    we count unique viewers without storing identifying data.
--
--    listing_favorites: ditto for the "heart" button. Same shape.
-- ----------------------------------------------------------------------------
create table if not exists public.listing_views (
  id bigserial primary key,
  listing_id text not null references public.market_listings(id) on delete cascade,
  anon_hash text,                                -- daily-rotating sha256
  observed_at timestamptz not null default now(),
  view_day date generated always as ((observed_at at time zone 'UTC')::date) stored,
  referrer_kind text,                            -- 'search'|'browse'|'direct'|null
  source text,                                   -- 'extension'|'web'|...
  unique (listing_id, anon_hash, view_day)
);

create index if not exists idx_listing_views_listing on public.listing_views(listing_id);
create index if not exists idx_listing_views_day on public.listing_views(view_day desc);

alter table public.listing_views enable row level security;
drop policy if exists "public read listing_views" on public.listing_views;
create policy "public read listing_views" on public.listing_views
  for select using (true);

create table if not exists public.listing_favorites (
  id bigserial primary key,
  listing_id text not null references public.market_listings(id) on delete cascade,
  anon_hash text,
  observed_at timestamptz not null default now(),
  source text,
  unique (listing_id, anon_hash)
);

create index if not exists idx_listing_favorites_listing on public.listing_favorites(listing_id);

alter table public.listing_favorites enable row level security;
drop policy if exists "public read listing_favorites" on public.listing_favorites;
create policy "public read listing_favorites" on public.listing_favorites
  for select using (true);

-- ----------------------------------------------------------------------------
-- 3. v_demand_index
--    Per-combo demand score: log(views_7d + 1) * (1 + favorites_7d / max(1, views_7d)).
--    The non-linearity keeps a single hyper-favourited listing from dominating;
--    the favourite-ratio bonus rewards combos where viewers convert to saves.
-- ----------------------------------------------------------------------------
create or replace view public.v_demand_index as
with views_7d as (
  select listing_id, count(*) as views
    from public.listing_views
   where observed_at >= now() - interval '7 days'
   group by 1
),
favs_7d as (
  select listing_id, count(*) as favs
    from public.listing_favorites
   where observed_at >= now() - interval '7 days'
   group by 1
)
select
  ml.id            as listing_id,
  public._combo_id_from_traits(coalesce(ml.cached_traits, ml.norm_traits)) as combo_id,
  coalesce(v.views, 0) as views_7d,
  coalesce(f.favs, 0)  as favorites_7d,
  ln(coalesce(v.views, 0) + 1)
    * (1 + (coalesce(f.favs, 0)::numeric / greatest(coalesce(v.views, 0), 1)))
  as demand_score
from public.market_listings ml
left join views_7d v on v.listing_id = ml.id
left join favs_7d  f on f.listing_id = ml.id
where ml.species in ('crested','unknown');
