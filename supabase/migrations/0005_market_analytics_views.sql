-- ============================================================================
-- Geck Inspect — 0005: market analytics views
--
-- Wires the /market dashboard to real Supabase data. Builds on the tables
-- created by 0001 (market_listings, market_sellers, listing_images),
-- 0002 (price_history, price_drops, listing_status_events, auction_results,
-- seller_snapshots, show_mentions, cross_platform_listings).
--
-- Everything here is read-only derived structure — no new base tables. The
-- application reads through these views with the anon key; RLS on the
-- underlying tables already permits public SELECT.
--
-- Safe to re-run; every create is IF NOT EXISTS / CREATE OR REPLACE and
-- every DROP uses IF EXISTS.
--
-- NOTE: all round(x, n) calls below cast to ::numeric first.
-- percentile_cont(...) and exp()/ln() return double precision, and Postgres
-- only implements round(numeric, int) — not round(double precision, int).
-- If you see "function round(double precision, integer) does not exist",
-- you're on the pre-cast version of this file; re-run it (everything here
-- is CREATE OR REPLACE so it's safe to re-apply).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. combo_catalog — the canonical list of trait combinations the dashboard
-- recognizes. UI components keep an identical list in TypeScript; this is
-- the SQL mirror so views can do set-based joins instead of per-row ifs.
--
-- Each row carries the display name plus lowercased trait tokens. A listing
-- matches the combo iff every token appears in its cached_traits OR
-- norm_traits column (case-insensitive substring match).
-- ----------------------------------------------------------------------------
create table if not exists public.combo_catalog (
  combo_name   text primary key,
  tokens       text[] not null,
  created_at   timestamptz not null default now()
);

-- Seed the 12 canonical combos used by the /market TypeScript fixtures.
insert into public.combo_catalog (combo_name, tokens) values
  ('Lilly White × Axanthic',          array['lilly white','axanthic']),
  ('Lilly White × Cappuccino',        array['lilly white','cappuccino']),
  ('Cappuccino × Full Pinstripe',     array['cappuccino','full pinstripe']),
  ('Axanthic × Full Pinstripe',       array['axanthic','full pinstripe']),
  ('Sable × Extreme Harlequin',       array['sable','extreme harlequin']),
  ('Frappuccino × Pinstripe',         array['frappuccino','pinstripe']),
  ('Moonglow × Super Dalmatian',      array['moonglow','super dalmatian']),
  ('Lilly White × Soft Scale',        array['lilly white','soft scale']),
  ('Axanthic × Extreme Harlequin',    array['axanthic','extreme harlequin']),
  ('Cappuccino × Super Dalmatian',    array['cappuccino','super dalmatian']),
  ('Red Harlequin',                   array['red harlequin']),
  ('Tiger × Pinstripe',               array['tiger','pinstripe'])
on conflict (combo_name) do update set tokens = excluded.tokens;

alter table public.combo_catalog enable row level security;
drop policy if exists "public read combo_catalog" on public.combo_catalog;
create policy "public read combo_catalog" on public.combo_catalog
  for select using (true);

-- ----------------------------------------------------------------------------
-- 2. combo_match(traits text) — returns the first combo_catalog row whose
-- tokens all appear in `traits` (lowercased). Returns NULL if no match.
-- A listing can match at most one combo for the purposes of rollups so
-- high-specificity combos are checked first (longest tokens first).
-- ----------------------------------------------------------------------------
create or replace function public.combo_match(p_traits text)
returns text
language sql
stable
parallel safe
set search_path = public
as $$
  select combo_name
  from public.combo_catalog
  where (
    select bool_and(
      position(token in lower(coalesce(p_traits, ''))) > 0
    )
    from unnest(tokens) as token
  )
  order by array_length(tokens, 1) desc, combo_name
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- 3. region_of(seller_location text) — coarse region classification used by
-- the Regional heatmap and Breeders table. Returns one of:
--   'US', 'CA', 'EU', 'UK', 'AU', 'JP', 'SE', 'SEA', or NULL.
--
-- Heuristics only — the dataset's seller_location is free-form text (city,
-- state, country). We match the country or country-code tail first, then
-- fall through to a few US/UK state abbreviations.
-- ----------------------------------------------------------------------------
create or replace function public.region_of(p_loc text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when p_loc is null then null

    -- Direct country matches
    when p_loc ~* '\mUSA\M|\munited states\M|\mU\.S\.|\mUS\M' then 'US'
    when p_loc ~* '\mCA\M|\mcanada\M|\bca$|ontario|quebec|alberta|british columbia' then 'CA'
    when p_loc ~* '\muk\M|united kingdom|england|scotland|wales|northern ireland' then 'UK'
    when p_loc ~* '\mAU\M|\maustralia\M|new south wales|victoria|queensland|tasmania' then 'AU'
    when p_loc ~* '\mJP\M|\mjapan\M|tokyo|osaka|kyoto|hokkaido' then 'JP'
    when p_loc ~* '\mSE\M|sweden|stockholm|gothenburg' then 'SE'
    when p_loc ~* 'singapore|malaysia|thailand|indonesia|vietnam|philippines|kuala lumpur|bangkok|jakarta|manila' then 'SEA'

    -- European fall-through
    when p_loc ~* 'germany|france|netherlands|belgium|italy|spain|austria|switzerland|poland|czech|greece|portugal|ireland|finland|norway|denmark|eu' then 'EU'

    -- US state abbreviations in brackets (common MorphMarket format)
    when p_loc ~* ',\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\M' then 'US'

    else null
  end;
$$;

-- ----------------------------------------------------------------------------
-- 4. v_combo_rollups(window_days) — for each combo, compute median sold,
-- median ask, % spread, avg days-to-sell, sold count, live count, and a
-- confidence score over the given window.
--
-- Implemented as a TABLE FUNCTION because materialized views can't take
-- parameters and we want the /market timeframe selector to change `window_days`.
-- ----------------------------------------------------------------------------
create or replace function public.v_combo_rollups(window_days int)
returns table (
  combo_name       text,
  sold_count       integer,
  live_count       integer,
  median_sold      numeric,
  median_ask       numeric,
  spread_pct       numeric,
  avg_days_to_sell numeric,
  confidence_score integer
)
language sql
stable
parallel safe
set search_path = public
as $$
with
-- Classify every in-range listing into its combo (or NULL).
classified as (
  select
    l.id,
    l.price_usd_equivalent,
    l.current_status,
    l.first_seen_at,
    l.last_seen_at,
    combo_match(coalesce(l.norm_traits, l.cached_traits)) as combo_name
  from public.market_listings l
  where l.price_usd_equivalent is not null
    and l.price_usd_equivalent > 0
    and l.price_usd_equivalent < 100000
),
-- Latest sold event in window per listing.
sold_events as (
  select
    lse.listing_id,
    max(lse.observed_at) as sold_at,
    max(lse.days_since_first_seen) as days_to_sell
  from public.listing_status_events lse
  where lse.status = 'sold'
    and lse.observed_at >= now() - make_interval(days => window_days)
  group by lse.listing_id
),
per_combo as (
  select
    c.combo_name,
    count(*) filter (where c.current_status = 'sold' and se.listing_id is not null) as sold_count,
    count(*) filter (where c.current_status = 'live') as live_count,
    percentile_cont(0.5) within group (order by c.price_usd_equivalent)
      filter (where c.current_status = 'sold' and se.listing_id is not null) as median_sold,
    percentile_cont(0.5) within group (order by c.price_usd_equivalent)
      filter (where c.current_status = 'live') as median_ask,
    avg(se.days_to_sell) filter (where se.days_to_sell is not null) as avg_days_to_sell
  from classified c
  left join sold_events se on se.listing_id = c.id
  where c.combo_name is not null
  group by c.combo_name
)
select
  pc.combo_name,
  coalesce(pc.sold_count, 0)::int  as sold_count,
  coalesce(pc.live_count, 0)::int  as live_count,
  pc.median_sold::numeric          as median_sold,
  pc.median_ask::numeric           as median_ask,
  case
    when pc.median_sold is null or pc.median_sold = 0 then null
    else round((((pc.median_ask - pc.median_sold) / pc.median_sold) * 100)::numeric, 1)
  end as spread_pct,
  round(pc.avg_days_to_sell::numeric, 1) as avg_days_to_sell,
  -- Confidence: start at 20, +2 per sold observation, +0.5 per live listing,
  -- capped at 99. Produces sensible gradient from thin to thick coverage.
  least(99,
    greatest(1,
      round((20 + coalesce(pc.sold_count, 0) * 2 + coalesce(pc.live_count, 0) * 0.5)::numeric)
    )
  )::int as confidence_score
from per_combo pc;
$$;

-- ----------------------------------------------------------------------------
-- 5. v_regional_pivot — combo × region median sold/ask over window. Uses
-- region_of() on the seller location to bucket listings. Unlike
-- v_combo_rollups we don't parameterize by window here; a materialized view
-- keyed on "last 365 days" is a reasonable default, with the app re-issuing
-- a function call for other windows.
-- ----------------------------------------------------------------------------
create or replace function public.v_regional_heatmap(window_days int)
returns table (
  combo_name  text,
  region      text,
  n           integer,
  median_sold numeric,
  median_ask  numeric,
  confidence_score integer
)
language sql
stable
parallel safe
set search_path = public
as $$
with
classified as (
  select
    l.id,
    l.seller_id,
    l.price_usd_equivalent,
    l.current_status,
    combo_match(coalesce(l.norm_traits, l.cached_traits)) as combo_name
  from public.market_listings l
  where l.price_usd_equivalent is not null
    and l.price_usd_equivalent > 0
    and l.price_usd_equivalent < 100000
),
sold_in_window as (
  select distinct listing_id
  from public.listing_status_events
  where status = 'sold'
    and observed_at >= now() - make_interval(days => window_days)
),
regionalised as (
  select
    c.combo_name,
    region_of(s.seller_location) as region,
    c.price_usd_equivalent,
    c.current_status,
    (siw.listing_id is not null) as sold_in_window
  from classified c
  left join public.market_sellers s on s.seller_id = c.seller_id
  left join sold_in_window siw on siw.listing_id = c.id
  where c.combo_name is not null
    and region_of(s.seller_location) is not null
)
select
  combo_name,
  region,
  count(*)::int as n,
  (percentile_cont(0.5) within group (order by price_usd_equivalent)
    filter (where sold_in_window and current_status = 'sold'))::numeric as median_sold,
  (percentile_cont(0.5) within group (order by price_usd_equivalent)
    filter (where current_status = 'live'))::numeric as median_ask,
  least(99, greatest(1, round((20 + count(*) * 5)::numeric)))::int as confidence_score
from regionalised
group by combo_name, region;
$$;

-- ----------------------------------------------------------------------------
-- 6. v_market_index — weekly weighted basket of high-value combos. The
-- index value represents the geometric average of the top-8 combos' median
-- sold prices, normalized so the oldest week in the requested window = 1000.
-- ----------------------------------------------------------------------------
create or replace function public.v_market_index(window_days int)
returns table (
  week_start timestamptz,
  value      numeric,
  combos_in  integer
)
language sql
stable
parallel safe
set search_path = public
as $$
with
classified as (
  select
    lse.observed_at,
    l.price_usd_equivalent,
    combo_match(coalesce(l.norm_traits, l.cached_traits)) as combo_name,
    date_trunc('week', lse.observed_at) as week_start
  from public.listing_status_events lse
  join public.market_listings l on l.id = lse.listing_id
  where lse.status = 'sold'
    and lse.observed_at >= now() - make_interval(days => window_days)
    and l.price_usd_equivalent > 0
    and l.price_usd_equivalent < 100000
),
weekly_medians as (
  select
    week_start,
    combo_name,
    percentile_cont(0.5) within group (order by price_usd_equivalent) as median_px,
    count(*) as n
  from classified
  where combo_name is not null
  group by week_start, combo_name
),
-- Geometric average per week across all combos that had a sale that week.
per_week as (
  select
    week_start,
    exp(avg(ln(median_px))) as geo_avg,
    count(distinct combo_name)::int as combos_in
  from weekly_medians
  where median_px > 0
  group by week_start
),
-- Anchor: first available week's geo_avg maps to 1000.
anchored as (
  select
    p.week_start,
    p.combos_in,
    (p.geo_avg / first_value(p.geo_avg) over (order by p.week_start)) * 1000 as value
  from per_week p
)
select week_start, round(value::numeric, 1) as value, combos_in
from anchored
order by week_start;
$$;

-- ----------------------------------------------------------------------------
-- 7. v_combo_source_blend — for each combo, break down its observations
-- across price_history.source so the Combo detail panel can show "how the
-- headline is assembled" (GI sales / GI listings / breeder / …).
-- ----------------------------------------------------------------------------
create or replace function public.v_combo_source_blend(p_combo text, window_days int)
returns table (
  source       text,
  n            integer,
  avg_price    numeric,
  pct          numeric
)
language sql
stable
parallel safe
set search_path = public
as $$
with
classified as (
  select l.id
  from public.market_listings l
  where combo_match(coalesce(l.norm_traits, l.cached_traits)) = p_combo
),
obs as (
  select
    coalesce(ph.source, 'gi_listings') as source,
    ph.price_usd_equivalent
  from public.price_history ph
  join classified c on c.id = ph.listing_id
  where ph.observed_at >= now() - make_interval(days => window_days)
    and ph.price_usd_equivalent > 0
),
per_source as (
  select
    source,
    count(*)::int as n,
    avg(price_usd_equivalent) as avg_price
  from obs
  group by source
),
totals as (
  select sum(n)::numeric as total_n from per_source
)
select
  ps.source,
  ps.n,
  round(ps.avg_price::numeric, 2) as avg_price,
  case
    when t.total_n = 0 then 0::numeric
    else round(((ps.n::numeric / t.total_n) * 100)::numeric, 1)
  end as pct
from per_source ps
cross join totals t
order by ps.n desc;
$$;

-- ----------------------------------------------------------------------------
-- 8. Grants — anon reads everything the functions return through RLS on the
-- underlying tables; no explicit grants required.
-- ----------------------------------------------------------------------------
-- (intentionally empty — function security comes from table policies.)
