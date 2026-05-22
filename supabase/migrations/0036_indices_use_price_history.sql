-- ============================================================================
-- Geck Data 0036: indices use price_history as substrate.
--
-- v_market_sub_index_weekly and combo_index_daily originally drew from
-- listing_status_events where status='sold'. The sold-events stream is
-- thin (~92 rows over 180d) so most anchor weeks and combo days came up
-- empty even though there is plenty of underlying market activity.
--
-- This migration re-creates both as observations from price_history,
-- which carries ~17K rows over 7585 listings in the last 180 days. The
-- indices change meaning from "median sold price" to "median observed
-- market price" (sold events are a subset of observations). This is an
-- honest reflection of what the data supports and matches Zillow ZHVI's
-- "all observed prices, smoothed" approach.
--
-- The /methodology page is updated in the same push to reflect the
-- definition change. All views are CREATE OR REPLACE; the MV is
-- dropped and recreated since its source query changes.
-- ============================================================================

create or replace view public.v_market_sub_index_weekly as
with obs as (
  select
    date_trunc('week', ph.observed_at)::date as week_start,
    coalesce(ph.price_usd_equivalent, ph.price) as price,
    lower(coalesce(ml.cached_traits, ml.norm_traits, '')) as traits_lower
  from public.price_history ph
  join public.market_listings ml on ml.id = ph.listing_id
  where ph.observed_at >= now() - interval '52 weeks'
    and ml.species in ('crested','unknown')
    and coalesce(ph.price_usd_equivalent, ph.price) is not null
    and coalesce(ph.price_usd_equivalent, ph.price) > 0
    and coalesce(ph.price_usd_equivalent, ph.price) < 100000
),
exploded as (
  select week_start, price, 'Lilly White'::text as anchor
    from obs where traits_lower like '%lilly white%'
  union all
  select week_start, price, 'Axanthic'::text from obs where traits_lower like '%axanthic%'
  union all
  select week_start, price, 'Harlequin'::text from obs
    where traits_lower like '%harlequin%' or traits_lower like '%extreme harlequin%'
  union all
  select week_start, price, 'Cappuccino'::text from obs
    where traits_lower like '%cappuccino%'
       or traits_lower like '%sable%'
       or traits_lower like '%frappuccino%'
)
select
  week_start,
  anchor,
  percentile_cont(0.5) within group (order by price)::numeric as median_price,
  count(*)::bigint as n
from exploded
group by week_start, anchor;

-- v_market_sub_index function signature unchanged; it reads the view above.

drop materialized view if exists public.combo_index_daily;
create materialized view public.combo_index_daily as
with daily as (
  select
    public._combo_id_from_traits(coalesce(ml.cached_traits, ml.norm_traits)) as combo_id,
    date_trunc('day', ph.observed_at)::date as day,
    percentile_cont(0.5) within group (order by coalesce(ph.price_usd_equivalent, ph.price))::numeric as median_price,
    count(*)::bigint as n
  from public.market_listings ml
  join public.price_history ph on ph.listing_id = ml.id
  where ph.observed_at >= now() - interval '365 days'
    and ml.species in ('crested','unknown')
    and coalesce(ph.price_usd_equivalent, ph.price) is not null
    and coalesce(ph.price_usd_equivalent, ph.price) > 0
    and coalesce(ph.price_usd_equivalent, ph.price) < 100000
  group by 1, 2
)
select * from daily where combo_id is not null;

create unique index if not exists combo_index_daily_pk
  on public.combo_index_daily (combo_id, day);

create index if not exists combo_index_daily_day_idx
  on public.combo_index_daily (day);

-- v_combo_index_summary unchanged structurally; it just reads the MV.
-- Re-emit it to pick up any latent changes the MV drop might have rolled
-- through dependency invalidation. CREATE OR REPLACE on a view that
-- references a recreated MV is safe in Postgres 17.
create or replace view public.v_combo_index_summary as
with latest as (
  select distinct on (combo_id)
    combo_id, day as latest_day, median_price as current_value, n as latest_n
  from public.combo_index_daily
  order by combo_id, day desc
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
left join prior_7d  p7  on p7.combo_id  = l.combo_id
left join prior_30d p30 on p30.combo_id = l.combo_id
left join prior_90d p90 on p90.combo_id = l.combo_id;

comment on view public.v_market_sub_index_weekly is
  'Weekly median observed market price per anchor morph family. Sourced from price_history (live observations). Crested only.';
comment on materialized view public.combo_index_daily is
  'Per-combo daily median observed market price + sample size, 365 day window. Sourced from price_history. Refresh nightly.';