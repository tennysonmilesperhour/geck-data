-- ============================================================================
-- Geck Data 0054: the weekly sold-activity series counts every reconciled
-- sale, not the 92-row captured slice.
--
-- sold_activity_weekly fed the /sold "Cumulative sales" chart from
-- listing_status_events, which holds 92 sold rows from four days in May, so
-- the chart was a single bar and the page had to label it "captured pool
-- only". v_sold_reconciled (migration 0045) carries every sale we have,
-- captured plus inferred, across the whole window. Group lots are excluded
-- because a lot is one transaction covering several animals.
-- ============================================================================

create or replace function public.sold_activity_weekly(p_weeks integer default 26)
returns table (week_start date, sold_count bigint)
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
    date_trunc('week', timezone('UTC', s.sold_at))::date as week_start,
    count(*)::bigint as sold_count
  from public.v_sold_reconciled s
  cross join bounds
  where s.sold_at is not null
    and not s.is_group_lot
    and s.sold_at >= bounds.starts_at at time zone 'UTC'
  group by 1
  order by 1;
$$;

comment on function public.sold_activity_weekly(integer) is
  'Weekly count of reconciled sales (captured + inferred, migration 0045), group lots excluded, over the trailing p_weeks. Replaces the listing_status_events source, which held only the 92-row captured pool from a single week.';

revoke all on function public.sold_activity_weekly(integer) from public;
grant execute on function public.sold_activity_weekly(integer) to anon, authenticated, service_role;
