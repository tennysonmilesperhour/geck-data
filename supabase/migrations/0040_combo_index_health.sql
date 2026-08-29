-- ============================================================================
-- Geck Data 0040: make a starved or no-op index refresh visible.
--
-- The nightly refresh workflow calls refresh_combo_index_daily() and prints
-- "refreshed combo_index_daily" on any 2xx. That is true but not useful: the
-- refresh returns void, so the job reported success for weeks while the view
-- held five days of history. The refresh was working; the view was starved
-- because almost nothing had parseable traits to build a combo from (see
-- 0039). Either failure mode looked identical from CI.
--
-- combo_index_health() closes that gap. It reports the newest day the view
-- holds against the newest day it COULD hold, using the same eligibility
-- rules as the materialized view itself (crested/unknown, two or more
-- trait tokens of 2..60 chars, a sane price). If lag_days > 0 the view is
-- behind its own inputs and the workflow fails loudly instead of printing
-- a green no-op.
--
-- lag_days = 0 on a quiet day is the healthy steady state: with a weekly
-- ingest most days add no new eligible observations, so "did max(day) move"
-- would false-alarm six days a week. Lag against available input is the
-- signal that actually means something is wrong.
-- ============================================================================

create or replace function public.combo_index_health()
returns table (
  mv_max_day          date,
  newest_eligible_day date,
  lag_days            integer,
  mv_rows             bigint,
  mv_combos           bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with mv as (
    select
      max(day)                    as mv_max_day,
      count(*)::bigint            as mv_rows,
      count(distinct combo_id)::bigint as mv_combos
    from public.combo_index_daily
  ),
  -- Listings the view can actually build a combo from: same filters as the
  -- MV's listing_traits CTE (0037), so this cannot drift into false alarms.
  listing_ok as (
    select ml.id
    from public.market_listings ml,
         lateral unnest(string_to_array(ml.cached_traits, ',')) t(t)
    where ml.cached_traits is not null
      and ml.species in ('crested','unknown')
    group by ml.id
    having count(distinct trim(both ' ' from t.t))
             filter (where length(trim(both ' ' from t.t)) between 2 and 60) >= 2
  ),
  eligible as (
    select max(date_trunc('day', ph.observed_at)::date) as newest_eligible_day
    from public.price_history ph
    join listing_ok lo on lo.id = ph.listing_id
    where ph.observed_at >= now() - interval '365 days'
      and coalesce(ph.price_usd_equivalent, ph.price) is not null
      and coalesce(ph.price_usd_equivalent, ph.price) > 0
      and coalesce(ph.price_usd_equivalent, ph.price) < 100000
  )
  select
    mv.mv_max_day,
    e.newest_eligible_day,
    case
      when e.newest_eligible_day is null or mv.mv_max_day is null then null
      else (e.newest_eligible_day - mv.mv_max_day)::integer
    end as lag_days,
    mv.mv_rows,
    mv.mv_combos
  from mv, eligible e;
$$;

revoke all on function public.combo_index_health() from public;
grant execute on function public.combo_index_health() to anon, authenticated, service_role;

comment on function public.combo_index_health() is
  'Health probe for combo_index_daily: newest day held vs newest day buildable from price_history. lag_days > 0 means the view is behind its inputs (refresh not running, or not reaching this database).';
