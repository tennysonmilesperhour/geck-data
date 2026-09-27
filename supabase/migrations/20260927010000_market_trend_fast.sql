-- market_trend computed everything from price_history on each call. Under
-- the public role's 3 second statement limit that timed out in production.
-- The per-listing, per-week rows now live in a materialized view refreshed
-- hourly with the other market views, so a page load only aggregates a few
-- thousand precomputed rows. Output is unchanged.

create materialized view if not exists geck_data.listing_week_mv as
with obs as (
  select regexp_replace(h.listing_id, '^mm_', '') as listing_id, h.observed_at, h.price
  from geck_data.price_history h
  where h.currency = 'USD' and h.price > 0 and h.price < 100000
),
l as (
  select l.listing_id, l.trait_array
  from geck_data.listings l
  where coalesce(l.species, 'unknown') in ('crested', 'unknown')
    and not geck_data._looks_like_group_lot(l.name, false)
),
o as (
  select o.*, lag(o.price) over (partition by o.listing_id order by o.observed_at) as prev
  from obs o
  join l using (listing_id)
)
select date_trunc('week', o.observed_at)::date as week,
  o.listing_id,
  (array_agg(o.price order by o.observed_at desc))[1] as price,
  bool_or(o.prev is not null and o.price < o.prev) as cut,
  bool_or(o.prev is not null and o.price > o.prev) as raised,
  min(case when o.prev is not null and o.price < o.prev then (o.prev - o.price) / o.prev end) as cut_pct,
  (select l.trait_array from l where l.listing_id = o.listing_id) as trait_array
from o
group by 1, 2;

create unique index if not exists listing_week_mv_pk on geck_data.listing_week_mv (week, listing_id);
create index if not exists listing_week_mv_traits on geck_data.listing_week_mv using gin (trait_array);
grant select on geck_data.listing_week_mv to anon, authenticated;

drop function if exists geck_data.market_trend(text);

create or replace function geck_data.market_trend(p_trait text default null)
returns table (
  week date, seen integer, p25 numeric, p50 numeric, p75 numeric,
  cuts integer, raises integer, median_cut numeric,
  new_listings integer, came_down integer, after_gap boolean, partial boolean
)
language sql
stable
security invoker
as $$
  with p as (
    select * from geck_data.listing_week_mv
    where p_trait is null or trait_array @> array[p_trait]
  ),
  weeks as (
    select p.week,
      count(*)::int as seen,
      round(percentile_cont(0.25) within group (order by p.price)::numeric, 0) as p25,
      round(percentile_cont(0.50) within group (order by p.price)::numeric, 0) as p50,
      round(percentile_cont(0.75) within group (order by p.price)::numeric, 0) as p75,
      count(*) filter (where p.cut)::int as cuts,
      count(*) filter (where p.raised)::int as raises,
      round((percentile_cont(0.5) within group (order by p.cut_pct) filter (where p.cut))::numeric, 2) as median_cut
    from p
    group by p.week
  ),
  -- Partial is judged on the whole market's check that week, so a rare
  -- morph's small counts never read as a partial scrape.
  market_weeks as (
    select m.week, count(*) as checked from geck_data.listing_week_mv m group by m.week
  ),
  sized as (
    select w.*, mw.checked < 0.5 * (select max(checked) from market_weeks) as partial
    from weeks w
    join market_weeks mw using (week)
  ),
  flagged as (
    select s.*,
      coalesce(lag(s.week) over (order by s.week) <> s.week - 7, true) as after_gap,
      coalesce(lag(s.partial) over (order by s.week), true) as prev_partial
    from sized s
  ),
  flow as (
    select date_trunc('week', v.first_seen_at)::date as seen_week,
      date_trunc('week', v.sold_at)::date as down_week
    from geck_data.listing_market_mv v
    where not v.is_lot
      and (p_trait is null or v.trait_array @> array[p_trait])
  )
  select f.week, f.seen, f.p25, f.p50, f.p75, f.cuts, f.raises, f.median_cut,
    case when f.after_gap or f.partial or f.prev_partial then null else
      (select count(*)::int from flow where flow.seen_week = f.week) end,
    case when f.after_gap or f.partial or f.prev_partial then null else
      (select count(*)::int from flow where flow.down_week = f.week) end,
    f.after_gap,
    f.partial
  from flagged f
  order by f.week;
$$;

grant execute on function geck_data.market_trend(text) to anon, authenticated;

create or replace function geck_data.refresh_market_matviews()
returns void
language sql
security definer
set search_path to 'pg_catalog', 'geck_data', 'extensions'
as $function$
  refresh materialized view concurrently geck_data.v_observed_traits;
  refresh materialized view concurrently geck_data.combo_weekly_prices_mv;
  refresh materialized view concurrently geck_data.v_sold_reconciled;
  refresh materialized view concurrently geck_data.listing_market_mv;
  refresh materialized view concurrently geck_data.listing_week_mv;
$function$;
