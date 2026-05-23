-- ============================================================================
-- Geck Data 0037: data-driven traits + combos. Replace hardcoded list.
--
-- Background: the previous 0035/0036 indices were keyed by
-- _combo_id_from_traits(), which is a 12-row hardcoded recognizer.
-- Most listings fell outside those twelve, so /indices and the
-- anchor tiles surfaced four morph families and roughly a dozen
-- combos. Anything else was invisible to the dashboard.
--
-- This migration adds two general-purpose views and rebuilds
-- combo_index_daily and v_combo_index_summary against the broader
-- universe. The cached_traits column is comma-space delimited
-- ("Lilly White, Axanthic, Tri-color"); we split on comma, trim
-- whitespace, and aggregate.
--
-- The new universe is honest about what we observe instead of what
-- the recognizer's first author thought was interesting.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. v_observed_traits
--    Every distinct morph trait observed in cached_traits with >= 3
--    crested listings, plus its current median price.
-- ----------------------------------------------------------------------------
create or replace view public.v_observed_traits as
with split as (
  select
    trim(t) as trait,
    coalesce(ml.price_usd_equivalent, ml.price) as price
  from public.market_listings ml,
       unnest(string_to_array(ml.cached_traits, ',')) as t
  where ml.cached_traits is not null
    and ml.species in ('crested','unknown')
    and coalesce(ml.price_usd_equivalent, ml.price) is not null
    and coalesce(ml.price_usd_equivalent, ml.price) > 0
    and coalesce(ml.price_usd_equivalent, ml.price) < 100000
)
select
  trait,
  count(*)::bigint as n,
  percentile_cont(0.5) within group (order by price)::numeric as median_price
from split
where length(trait) >= 2
  and length(trait) <= 60
group by trait
having count(*) >= 3
order by n desc;

comment on view public.v_observed_traits is
  'Every distinct trait token observed in market_listings.cached_traits with >= 3 listings. Sourced live; no curation. Used by /indices and Pulse anchor tiles.';

-- ----------------------------------------------------------------------------
-- 2. v_observed_combos
--    Every ordered pair (a, b) of traits that co-occur on at least 3
--    crested listings, with their joint median price and count.
--    The combo_name is sorted alphabetically so "Axanthic x Lilly White"
--    and "Lilly White x Axanthic" collapse to one row.
-- ----------------------------------------------------------------------------
create or replace view public.v_observed_combos as
with traits_per_listing as (
  select
    ml.id,
    coalesce(ml.price_usd_equivalent, ml.price) as price,
    array_agg(distinct trim(t)) filter (
      where length(trim(t)) >= 2 and length(trim(t)) <= 60
    ) as traits
  from public.market_listings ml,
       unnest(string_to_array(ml.cached_traits, ',')) as t
  where ml.cached_traits is not null
    and ml.species in ('crested','unknown')
    and coalesce(ml.price_usd_equivalent, ml.price) is not null
    and coalesce(ml.price_usd_equivalent, ml.price) > 0
    and coalesce(ml.price_usd_equivalent, ml.price) < 100000
  group by ml.id, coalesce(ml.price_usd_equivalent, ml.price)
),
pairs as (
  select
    least(t.traits[i], t.traits[j]) || ' x ' || greatest(t.traits[i], t.traits[j]) as combo_name,
    t.price
  from traits_per_listing t,
       generate_subscripts(t.traits, 1) i,
       generate_subscripts(t.traits, 1) j
  where i < j
    and array_length(t.traits, 1) >= 2
)
select
  combo_name,
  count(*)::bigint as n,
  percentile_cont(0.5) within group (order by price)::numeric as median_price
from pairs
group by combo_name
having count(*) >= 3
order by n desc;

comment on view public.v_observed_combos is
  'Every observed two-trait combination with >= 3 crested listings. Auto-discovered from cached_traits; not curated. Used by /indices.';

-- ----------------------------------------------------------------------------
-- 3. combo_index_daily REBUILT
--    Switch keying from the 12-row _combo_id_from_traits() recognizer
--    to an auto-discovered combo_name (sorted-trait-pair). Same shape
--    as before so v_combo_index_summary keeps working; just opens up
--    the universe of combos that can render on /indices.
--
--    For each listing-day in price_history, we explode the listing's
--    trait list into every ordered pair and emit one row per pair.
-- ----------------------------------------------------------------------------
drop materialized view if exists public.combo_index_daily cascade;
create materialized view public.combo_index_daily as
with listing_traits as (
  select
    ml.id,
    array_agg(distinct trim(t)) filter (
      where length(trim(t)) >= 2 and length(trim(t)) <= 60
    ) as traits
  from public.market_listings ml,
       unnest(string_to_array(ml.cached_traits, ',')) as t
  where ml.cached_traits is not null
    and ml.species in ('crested','unknown')
  group by ml.id
),
exploded as (
  select
    least(lt.traits[i], lt.traits[j]) || ' x ' || greatest(lt.traits[i], lt.traits[j]) as combo_id,
    date_trunc('day', ph.observed_at)::date as day,
    coalesce(ph.price_usd_equivalent, ph.price) as price
  from listing_traits lt
  join public.price_history ph on ph.listing_id = lt.id,
       generate_subscripts(lt.traits, 1) i,
       generate_subscripts(lt.traits, 1) j
  where i < j
    and array_length(lt.traits, 1) >= 2
    and ph.observed_at >= now() - interval '365 days'
    and coalesce(ph.price_usd_equivalent, ph.price) is not null
    and coalesce(ph.price_usd_equivalent, ph.price) > 0
    and coalesce(ph.price_usd_equivalent, ph.price) < 100000
)
select
  combo_id,
  day,
  percentile_cont(0.5) within group (order by price)::numeric as median_price,
  count(*)::bigint as n
from exploded
group by combo_id, day
having count(*) >= 1;

create unique index combo_index_daily_pk
  on public.combo_index_daily (combo_id, day);

create index combo_index_daily_day_idx
  on public.combo_index_daily (day);

create index combo_index_daily_n_idx
  on public.combo_index_daily (n desc);

comment on materialized view public.combo_index_daily is
  'Per-combo (sorted-trait-pair) daily median observed market price over 365 days. Auto-discovered from cached_traits, no hardcoded combo list. Refresh nightly.';

-- ----------------------------------------------------------------------------
-- 4. v_combo_index_summary unchanged structurally; re-emit so the
--    rebuilt MV is wired in.
-- ----------------------------------------------------------------------------
create or replace view public.v_combo_index_summary as
with latest as (
  select distinct on (combo_id)
    combo_id, day as latest_day, median_price as current_value, n as latest_n
  from public.combo_index_daily
  order by combo_id, day desc
),
totals as (
  select combo_id, sum(n)::bigint as total_n
  from public.combo_index_daily
  group by combo_id
),
prior_7d as (
  select distinct on (combo_id)
    combo_id, median_price as v7
  from public.combo_index_daily
  where day <= current_date - 7
  order by combo_id, day desc
),
prior_30d as (
  select distinct on (combo_id)
    combo_id, median_price as v30
  from public.combo_index_daily
  where day <= current_date - 30
  order by combo_id, day desc
),
prior_90d as (
  select distinct on (combo_id)
    combo_id, median_price as v90
  from public.combo_index_daily
  where day <= current_date - 90
  order by combo_id, day desc
)
select
  l.combo_id,
  l.latest_day,
  l.current_value,
  l.latest_n,
  coalesce(tot.total_n, l.latest_n) as total_n,
  case when p7.v7 is null or p7.v7 = 0 then null
       else round(((l.current_value - p7.v7) / p7.v7) * 100, 2)
  end as delta_7d,
  case when p30.v30 is null or p30.v30 = 0 then null
       else round(((l.current_value - p30.v30) / p30.v30) * 100, 2)
  end as delta_30d,
  case when p90.v90 is null or p90.v90 = 0 then null
       else round(((l.current_value - p90.v90) / p90.v90) * 100, 2)
  end as delta_90d
from latest l
left join totals  tot on tot.combo_id = l.combo_id
left join prior_7d  p7  on p7.combo_id  = l.combo_id
left join prior_30d p30 on p30.combo_id = l.combo_id
left join prior_90d p90 on p90.combo_id = l.combo_id;

comment on view public.v_combo_index_summary is
  'Per-combo current value, total sample size, and 7/30/90d trailing deltas. Auto-discovered combos.';
