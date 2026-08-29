-- ============================================================================
-- Geck Data 0047: per-combo weekly history that does not depend on what is
-- live today.
--
-- /combo/[slug] built its 26 week price line from the price_history of the
-- first 200 listings that are CURRENTLY live and match the combo, then merged
-- sold prices into the same series. Three problems in one chart:
--
--   * Survivorship. A listing that sold in May is no longer live, so it drops
--     out of the history entirely. The line therefore describes the animals
--     that did NOT sell, which is the opposite of a market history.
--   * Mixed semantics. Asking-price observations and sold prices were summed
--     into one median without distinction.
--   * A silent cap. .slice(0, 200) on the members and .limit(4000) on the
--     ticks bound the answer with no disclosure.
--
-- This computes the series in SQL over every listing that has ever carried
-- both traits, using the one-observation-per-listing-per-week substrate from
-- 0043, and returns unique listing counts so the page can show its own
-- sample size. Asks only: sold prices are a different measurement and belong
-- in their own series.
-- ============================================================================

create or replace function public.combo_weekly_prices(
  p_trait_a   text,
  p_trait_b   text,
  window_days integer default 180
)
returns table (
  week_start    date,
  median_price  numeric,
  n_listings    bigint,
  observed_days bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select date_trunc('week', timezone('UTC', now())
      - make_interval(days => least(greatest(coalesce(window_days, 180), 1), 730)))::date as from_week
  ),
  members as (
    select ml.id
    from public.market_listings ml
    where ml.cached_traits is not null
      and ml.species in ('crested', 'unknown')
      and not ml.is_group_lot
      and ml.cached_traits ilike '%' || p_trait_a || '%'
      and ml.cached_traits ilike '%' || p_trait_b || '%'
  )
  select
    w.week_start,
    round(percentile_cont(0.5) within group (order by w.price)::numeric, 2) as median_price,
    count(distinct w.listing_id)::bigint as n_listings,
    count(distinct w.observed_day)::bigint as observed_days
  from public.v_listing_week_price w
  join members m on m.id = w.listing_id
  cross join bounds b
  where w.week_start >= b.from_week
  group by w.week_start
  order by w.week_start;
$$;

comment on function public.combo_weekly_prices(text, text, integer) is
  'Weekly median observed ASK for every listing that has carried both traits, live or not, one observation per listing per week, group lots excluded. Sold prices are deliberately not mixed in.';

revoke all on function public.combo_weekly_prices(text, text, integer) from public;
grant execute on function public.combo_weekly_prices(text, text, integer) to anon, authenticated, service_role;
