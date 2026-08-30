-- ============================================================================
-- Geck Data 0055: rebuild the headline Market Index on the asking-price basis
-- its own sub-indices already use, so the hero stops rendering empty.
--
-- v_market_index was built from listing_status_events (status = 'sold'). The
-- warehouse holds ~81 sold listings across four days in May, so once bucketed
-- by ISO week the index collapsed to a single week and fetchMarketIndex, which
-- needs >= 2 points to draw a line and a delta, fell back to its empty state.
-- The hero card on /market was blank while every other panel had data.
--
-- The four anchor sub-indices under this same hero (Lilly White, Axanthic,
-- Harlequin, Cappuccino) are already an asking-price weekly series
-- (v_market_sub_index_weekly, sourced from price_history) with six weeks and
-- thousands of observations behind each point. Define the headline index as
-- the geometric mean of those same four anchor medians per week, normalized to
-- 1,000 at the earliest week in the window. The index and its four component
-- lines now share one basis and one source, and the basket is asking prices,
-- which is what the card's source badge and subtitle now say. When sold volume
-- grows enough to index weekly on its own, this can move back to a sold basis.
-- ============================================================================

create or replace function public.v_market_index(window_days integer)
returns table (week_start timestamp with time zone, value numeric, combos_in integer)
language sql
stable
parallel safe
set search_path to 'public'
as $function$
  with weekly as (
    -- One row per (week, anchor): the weekly median asking price for each of
    -- the four anchor morphs, straight from the sub-index source view.
    select week_start, anchor, median_price, n
    from public.v_market_sub_index_weekly
    where week_start >= (current_date - make_interval(days => window_days))
      and median_price > 0
  ),
  per_week as (
    -- Basket level for the week = geometric mean of the anchor medians. The
    -- geometric mean keeps a single high-priced anchor from dominating the
    -- level the way an arithmetic mean would.
    select
      week_start,
      exp(avg(ln(median_price)))       as geo_avg,
      count(distinct anchor)::int      as combos_in
    from weekly
    group by week_start
  ),
  anchored as (
    -- Index the basket to 1,000 at the earliest week in view.
    select
      week_start,
      combos_in,
      (geo_avg / first_value(geo_avg) over (order by week_start)) * 1000 as value
    from per_week
  )
  select
    week_start::timestamptz,
    round(value::numeric, 1),
    combos_in
  from anchored
  order by week_start;
$function$;
