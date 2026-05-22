-- ============================================================================
-- Geck Data 0034: composite anchor-morph sub-indices + combo daily history.
--
-- Activates the previously-stubbed v_market_sub_index RPC (was referenced
-- by src/lib/market/queries.ts and always returned the empty state) and
-- adds a per-combo daily history table for fast sparkline retrieval.
--
-- All views are CREATE OR REPLACE so the file is replayable. Crested-only;
-- same species filter as 0029.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. v_market_sub_index_weekly
--    Weekly median sold price per anchor morph family. An anchor is a coarse
--    family tag (Lilly White, Axanthic, Cappuccino-line, Harlequin) inferred
--    from cached_traits / norm_traits with case-insensitive substring match.
--    A listing can contribute to multiple anchors (e.g. Lilly White x Axanthic
--    counts towards both); each anchor is computed independently.
-- ----------------------------------------------------------------------------
create or replace view public.v_market_sub_index_weekly as
with sold as (
  select
    lse.observed_at,
    date_trunc('week', lse.observed_at)::date as week_start,
    coalesce(ml.price_usd_equivalent, ml.price) as price,
    lower(coalesce(ml.cached_traits, ml.norm_traits, '')) as traits_lower
  from public.market_listings ml
  join public.listing_status_events lse
    on lse.listing_id = ml.id
   and lse.status = 'sold'
   and lse.observed_at >= now() - interval '52 weeks'
  where ml.species in ('crested','unknown')
    and coalesce(ml.price_usd_equivalent, ml.price) is not null
    and coalesce(ml.price_usd_equivalent, ml.price) > 0
    and coalesce(ml.price_usd_equivalent, ml.price) < 100000
),
exploded as (
  select week_start, price, 'Lilly White'::text as anchor
    from sold where traits_lower like '%lilly white%'
  union all
  select week_start, price, 'Axanthic'::text from sold where traits_lower like '%axanthic%'
  union all
  select week_start, price, 'Harlequin'::text from sold
    where traits_lower like '%harlequin%' or traits_lower like '%extreme harlequin%'
  union all
  -- Cappuccino anchor groups the full Cappuccino family (Cappuccino,
  -- Sable, Frappuccino) since they share parentage and price together.
  select week_start, price, 'Cappuccino'::text from sold
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

-- ----------------------------------------------------------------------------
-- 2. v_market_sub_index(window_days)
--    Wraps the weekly view, narrows to the requested window, and rebases
--    each anchor's first non-null week to 1000 for chart comparison.
-- ----------------------------------------------------------------------------
create or replace function public.v_market_sub_index(window_days int default 365)
returns table (
  anchor       text,
  week_start   date,
  value        numeric,
  median_price numeric,
  n            bigint
)
language sql
stable
parallel safe
set search_path = public
as $$
  with windowed as (
    select anchor, week_start, median_price, n
    from public.v_market_sub_index_weekly
    where week_start >= current_date - make_interval(days => window_days)
  ),
  anchored as (
    select
      anchor,
      week_start,
      median_price,
      n,
      first_value(median_price) over (
        partition by anchor order by week_start
        rows between unbounded preceding and unbounded following
      ) as base
    from windowed
  )
  select
    anchor,
    week_start,
    case when base is null or base = 0
         then null
         else round((median_price / base) * 1000, 1)
    end as value,
    round(median_price, 2) as median_price,
    n
  from anchored
  order by anchor, week_start;
$$;

-- ----------------------------------------------------------------------------
-- 3. combo_index_daily
--    Materialised per-combo daily history: combo_id, day, median sold price,
--    sample size. Refresh strategy: nightly via the existing
--    apply-migrations.yml-adjacent workflow, or on demand via
--    refresh_combo_index_daily(). The MV is bounded to 365 days so the
--    refresh stays cheap.
-- ----------------------------------------------------------------------------
drop materialized view if exists public.combo_index_daily;
create materialized view public.combo_index_daily as
with daily as (
  select
    public._combo_id_from_traits(coalesce(ml.cached_traits, ml.norm_traits)) as combo_id,
    date_trunc('day', lse.observed_at)::date as day,
    percentile_cont(0.5) within group (order by coalesce(ml.price_usd_equivalent, ml.price))::numeric as median_price,
    count(*)::bigint as n
  from public.market_listings ml
  join public.listing_status_events lse
    on lse.listing_id = ml.id
   and lse.status = 'sold'
   and lse.observed_at >= now() - interval '365 days'
  where ml.species in ('crested','unknown')
    and coalesce(ml.price_usd_equivalent, ml.price) is not null
    and coalesce(ml.price_usd_equivalent, ml.price) > 0
    and coalesce(ml.price_usd_equivalent, ml.price) < 100000
  group by 1, 2
)
select * from daily where combo_id is not null;

create unique index if not exists combo_index_daily_pk
  on public.combo_index_daily (combo_id, day);

create index if not exists combo_index_daily_day_idx
  on public.combo_index_daily (day);

-- Refresh helper. Callable from a scheduled GitHub Action or via
-- supabase MCP execute_sql when the source data has materially changed.
create or replace function public.refresh_combo_index_daily()
returns void
language sql
security definer
as $$
  refresh materialized view concurrently public.combo_index_daily;
$$;

-- ----------------------------------------------------------------------------
-- 4. v_combo_index_summary
--    Convenience view: for each combo, current value (latest day's median),
--    7d / 30d / 90d delta percentages, and the last 90 daily medians for
--    sparkline rendering. Backs the /indices route and the per-combo entity
--    page hero.
-- ----------------------------------------------------------------------------
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
  'Weekly median sold price per anchor morph family. Crested only.';
comment on function public.v_market_sub_index(int) is
  'Anchor sub-index rebased to 1000 at window start. Used by /indices and /market.';
comment on materialized view public.combo_index_daily is
  'Per-combo daily median sold price + sample size, 365 day window. Refresh nightly.';
comment on view public.v_combo_index_summary is
  'Per-combo current value + 7/30/90d deltas. Backs /indices and combo entity hero.';
