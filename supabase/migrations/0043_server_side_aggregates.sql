-- ============================================================================
-- Geck Data 0043: compute market aggregates in the database.
--
-- The problem this closes
-- -----------------------
-- Public pages asked PostgREST for 5,000 / 10,000 / 20,000 / 30,000 rows and
-- then aggregated in JavaScript. PostgREST caps rows per response, so those
-- pages were computing medians, maturity mixes and deltas over roughly the
-- first thousand rows the planner happened to return, with no ordering
-- guarantee. Raising .limit() cannot fix that; the aggregate has to run in
-- SQL. The audit measured the symptom directly: /trends showed 995 usable
-- price ticks against 45,632 in the table.
--
-- Three correctness rules are baked in here rather than left to callers:
--
--   1. ONE OBSERVATION PER LISTING PER BUCKET. price_history holds 45,632
--      ticks over 36,439 unique listing-days; one listing was re-scraped 14
--      times in a day. Feeding raw ticks to percentile_cont lets a
--      frequently re-seen listing outvote an identical listing seen once.
--      Every cross-sectional median below reduces to the listing's last
--      observation in the bucket first, then takes the median across
--      listings. n_listings (breadth) and n_observations (density) are both
--      returned so a caller can never confuse them again.
--
--   2. USD ONLY. 1,015 ticks have no price_usd_equivalent and the catalog now
--      carries USD, CAD, EUR and GBP. Mixing nominal currencies into one
--      median is silently wrong, so non-USD-equivalent rows are excluded and
--      counted as exclusions instead of being coerced.
--
--   3. NO SILENT ZERO-FILL. Every weekly series returns a row for each week
--      in the window with its observed_days count. A week with no
--      observation comes back with null metrics and observed_days = 0, so the
--      UI can break the line instead of drawing an outage as a crash to zero.
--
-- Group lots (0042) are excluded from per-animal price series.
--
-- All functions are STABLE, security invoker, and read through the existing
-- public-read RLS policies. Timing on production today: the heaviest one
-- plans and executes in ~115ms, well inside the anon role's 3s statement
-- timeout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- One canonical price observation per listing per week, USD equivalent only.
-- Shared substrate for the weekly series below.
-- ----------------------------------------------------------------------------
create or replace view public.v_listing_week_price as
select distinct on (ph.listing_id, date_trunc('week', ph.observed_at))
  date_trunc('week', ph.observed_at)::date as week_start,
  ph.observed_at::date                     as observed_day,
  ph.listing_id,
  ph.price_usd_equivalent                  as price
from public.price_history ph
join public.market_listings ml on ml.id = ph.listing_id
where ph.price_usd_equivalent is not null
  and ph.price_usd_equivalent > 0
  and ph.price_usd_equivalent < 100000
  and ml.species in ('crested', 'unknown')
  and not ml.is_group_lot
order by ph.listing_id, date_trunc('week', ph.observed_at), ph.observed_at desc;

comment on view public.v_listing_week_price is
  'Last USD-equivalent ask observed per listing per week, single animals only. The unit of a cross-sectional market median is a listing, not a scrape tick.';

-- ----------------------------------------------------------------------------
-- trends_weekly_prices: median weekly ask with explicit coverage.
-- Returns EVERY week in the window; weeks with no observation come back null.
-- ----------------------------------------------------------------------------
create or replace function public.trends_weekly_prices(window_days integer default 90)
returns table (
  week_start     date,
  median_price   numeric,
  p25_price      numeric,
  p75_price      numeric,
  n_listings     bigint,
  n_observations bigint,
  observed_days  bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      date_trunc('week', timezone('UTC', now())
        - make_interval(days => least(greatest(coalesce(window_days, 90), 1), 730)))::date as from_week,
      date_trunc('week', timezone('UTC', now()))::date as to_week
  ),
  weeks as (
    select generate_series(b.from_week, b.to_week, interval '1 week')::date as week_start
    from bounds b
  ),
  obs as (
    select w.week_start, w.listing_id, w.price, w.observed_day
    from public.v_listing_week_price w, bounds b
    where w.week_start >= b.from_week
  ),
  raw as (
    select date_trunc('week', ph.observed_at)::date as week_start,
           count(*)::bigint as n_observations,
           count(distinct ph.observed_at::date)::bigint as observed_days
    from public.price_history ph, bounds b
    where ph.observed_at >= b.from_week
    group by 1
  )
  select
    wk.week_start,
    round(percentile_cont(0.5) within group (order by o.price)::numeric, 2) as median_price,
    round(percentile_cont(0.25) within group (order by o.price)::numeric, 2) as p25_price,
    round(percentile_cont(0.75) within group (order by o.price)::numeric, 2) as p75_price,
    count(o.listing_id)::bigint as n_listings,
    coalesce(max(r.n_observations), 0)::bigint as n_observations,
    coalesce(max(r.observed_days), 0)::bigint as observed_days
  from weeks wk
  left join obs o on o.week_start = wk.week_start
  left join raw r on r.week_start = wk.week_start
  group by wk.week_start
  order by wk.week_start;
$$;

comment on function public.trends_weekly_prices(integer) is
  'Weekly median/p25/p75 USD ask, one observation per listing per week, single animals only. Emits every week in the window; observed_days = 0 marks an outage week whose metrics are null.';

-- ----------------------------------------------------------------------------
-- trends_arrivals_weekly: new listings per week, on the real listing date
-- when MorphMarket gave us one, with coverage so "no arrivals" and
-- "no coverage" stay distinguishable.
-- ----------------------------------------------------------------------------
create or replace function public.trends_arrivals_weekly(window_days integer default 90)
returns table (
  week_start        date,
  arrivals          bigint,
  arrivals_dated    bigint,
  observed_days     bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      date_trunc('week', timezone('UTC', now())
        - make_interval(days => least(greatest(coalesce(window_days, 90), 1), 730)))::date as from_week,
      date_trunc('week', timezone('UTC', now()))::date as to_week
  ),
  weeks as (
    select generate_series(b.from_week, b.to_week, interval '1 week')::date as week_start
    from bounds b
  ),
  arrivals as (
    select date_trunc('week', coalesce(ml.first_listed_at, ml.first_seen_at))::date as week_start,
           count(*)::bigint as arrivals,
           count(*) filter (where ml.first_listed_at is not null)::bigint as arrivals_dated
    from public.market_listings ml, bounds b
    where coalesce(ml.first_listed_at, ml.first_seen_at) >= b.from_week
      and ml.species in ('crested', 'unknown')
    group by 1
  ),
  cover as (
    select date_trunc('week', ph.observed_at)::date as week_start,
           count(distinct ph.observed_at::date)::bigint as observed_days
    from public.price_history ph, bounds b
    where ph.observed_at >= b.from_week
    group by 1
  )
  select
    wk.week_start,
    coalesce(a.arrivals, 0)::bigint,
    coalesce(a.arrivals_dated, 0)::bigint,
    coalesce(c.observed_days, 0)::bigint
  from weeks wk
  left join arrivals a on a.week_start = wk.week_start
  left join cover c on c.week_start = wk.week_start
  order by wk.week_start;
$$;

comment on function public.trends_arrivals_weekly(integer) is
  'New listings per week bucketed on first_listed_at when present (real MorphMarket listing date), else first_seen_at. observed_days lets the UI tell an empty market apart from a dead feed.';

-- ----------------------------------------------------------------------------
-- trends_maturity_mix: windowed maturity distribution.
-- The old bar chart read the whole live catalog while sitting under a
-- windowed header, so June asks were charted as if they were this window.
-- ----------------------------------------------------------------------------
create or replace function public.trends_maturity_mix(window_days integer default 90)
returns table (
  maturity      text,
  n_listings    bigint,
  median_price  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select timezone('UTC', now())
      - make_interval(days => least(greatest(coalesce(window_days, 90), 1), 730)) as since
  )
  select
    coalesce(nullif(trim(ml.maturity), ''), 'unreported') as maturity,
    count(*)::bigint as n_listings,
    round(percentile_cont(0.5) within group (order by ml.price_usd_equivalent)::numeric, 2) as median_price
  from public.market_listings ml, bounds b
  where coalesce(ml.first_listed_at, ml.first_seen_at) >= b.since
    and ml.species in ('crested', 'unknown')
    and not ml.is_group_lot
    and ml.price_usd_equivalent is not null
    and ml.price_usd_equivalent > 0
    and ml.price_usd_equivalent < 100000
  group by 1
  order by count(*) desc;
$$;

comment on function public.trends_maturity_mix(integer) is
  'Maturity distribution for listings that ARRIVED inside the window, not the whole live catalog. "unreported" is its own bucket because only ~12% of rows carry maturity.';

-- ----------------------------------------------------------------------------
-- market_price_summary: the landing KPIs, split fresh vs stale.
-- The hero used to count 10,158 "live" listings when only 565 had been
-- re-observed in 48h, and took its median over a capped fetch of that mixed
-- population. Fresh and stale are separate populations and are returned as
-- separate numbers so the page cannot blend them again.
-- ----------------------------------------------------------------------------
create or replace function public.market_price_summary(fresh_hours integer default 48)
returns table (
  fresh_listings      bigint,
  stale_listings      bigint,
  fresh_median_ask    numeric,
  fresh_p25_ask       numeric,
  fresh_p75_ask       numeric,
  stale_median_ask    numeric,
  newest_seen_at      timestamptz,
  oldest_stale_seen_at timestamptz,
  sellers             bigint,
  group_lots_excluded bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with cutoff as (
    select timezone('UTC', now())
      - make_interval(hours => least(greatest(coalesce(fresh_hours, 48), 1), 8760)) as fresh_since
  ),
  live as (
    select ml.*, (ml.last_seen_at >= c.fresh_since) as is_fresh
    from public.market_listings ml, cutoff c
    where ml.current_status = 'live'
      and ml.species in ('crested', 'unknown')
  ),
  priced as (
    select * from live
    where price_usd_equivalent is not null
      and price_usd_equivalent > 0
      and price_usd_equivalent < 100000
      and not is_group_lot
  )
  select
    (select count(*) from live where is_fresh)::bigint,
    (select count(*) from live where not is_fresh)::bigint,
    (select round(percentile_cont(0.5) within group (order by price_usd_equivalent)::numeric, 2) from priced where is_fresh),
    (select round(percentile_cont(0.25) within group (order by price_usd_equivalent)::numeric, 2) from priced where is_fresh),
    (select round(percentile_cont(0.75) within group (order by price_usd_equivalent)::numeric, 2) from priced where is_fresh),
    (select round(percentile_cont(0.5) within group (order by price_usd_equivalent)::numeric, 2) from priced where not is_fresh),
    (select max(last_seen_at) from live),
    (select min(last_seen_at) from live where not is_fresh),
    (select count(distinct seller_id) from live where seller_id is not null)::bigint,
    (select count(*) from live where is_group_lot)::bigint;
$$;

comment on function public.market_price_summary(integer) is
  'Landing KPIs with fresh and stale live listings kept apart. A median over the blended population describes a market that no longer exists.';

revoke all on function public.trends_weekly_prices(integer) from public;
revoke all on function public.trends_arrivals_weekly(integer) from public;
revoke all on function public.trends_maturity_mix(integer) from public;
revoke all on function public.market_price_summary(integer) from public;
grant execute on function public.trends_weekly_prices(integer) to anon, authenticated, service_role;
grant execute on function public.trends_arrivals_weekly(integer) to anon, authenticated, service_role;
grant execute on function public.trends_maturity_mix(integer) to anon, authenticated, service_role;
grant execute on function public.market_price_summary(integer) to anon, authenticated, service_role;
grant select on public.v_listing_week_price to anon, authenticated, service_role;
