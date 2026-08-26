-- The public /sold chart only needs 26 weekly counts. Returning raw event
-- history made every crawler hit transfer and serialize up to 20k rows.
create or replace function public.sold_activity_weekly(p_weeks integer default 26)
returns table (
  week_start date,
  sold_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      date_trunc('week', timezone('UTC', now()))
        - make_interval(weeks => least(greatest(coalesce(p_weeks, 26), 1), 104) - 1)
        as starts_at
  )
  select
    date_trunc('week', timezone('UTC', events.observed_at))::date as week_start,
    count(*)::bigint as sold_count
  from public.listing_status_events as events
  cross join bounds
  where events.status = 'sold'
    and events.observed_at >= bounds.starts_at at time zone 'UTC'
  group by 1
  order by 1;
$$;

revoke all on function public.sold_activity_weekly(integer) from public;
grant execute on function public.sold_activity_weekly(integer) to anon, authenticated, service_role;

comment on function public.sold_activity_weekly(integer) is
  'Weekly sold-event counts for the public cumulative-sales chart; bounded to 1-104 weeks.';
