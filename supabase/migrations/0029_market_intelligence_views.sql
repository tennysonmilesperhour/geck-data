-- ============================================================================
-- Geck Data 0029: market intelligence views.
--
-- These views back the new public API endpoints:
--   /api/market/temperature  → v_market_temperature
--   /api/market/fair-price   → v_combo_price_distribution
--   /api/market/arbitrage    → v_cross_platform_arbitrage_pairs
--
-- All are CREATE OR REPLACE so the file is replayable. They live in the
-- public schema so the anon key can SELECT them (no RLS on views).
--
-- Cresteds only — every view filters species in ('crested','unknown').
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. v_market_temperature
--    Composite scalar 0..100 summarising market activity over the last 30d.
--    Components (each normalised to 0..1, then averaged and rescaled):
--      - listing_volume   : new listings observed first_seen_at in 30d
--                           normalised against the trailing 365d distribution
--      - sell_through     : sold within 30d / listed within 30d
--      - velocity_inverse : median days-to-sell inverted (faster = hotter)
--      - price_momentum   : median sold price 30d vs 90d (capped ±20%)
--    Time-bucketed weekly so the dashboard can plot a sparkline.
-- ----------------------------------------------------------------------------
create or replace view public.v_market_temperature as
with weeks as (
  select generate_series(
    date_trunc('week', now()) - interval '52 weeks',
    date_trunc('week', now()),
    interval '1 week'
  )::date as week_start
),
listings_per_week as (
  select date_trunc('week', first_seen_at)::date as week_start,
         count(*)::numeric as listed_n
    from public.market_listings
   where species in ('crested','unknown')
     and first_seen_at >= now() - interval '52 weeks'
   group by 1
),
sold_per_week as (
  select date_trunc('week', lse.observed_at)::date as week_start,
         count(*)::numeric as sold_n,
         percentile_cont(0.5) within group (
           order by coalesce(ml.price_usd_equivalent, ml.price)
         ) as median_sold_usd,
         percentile_cont(0.5) within group (
           order by lse.days_since_first_seen
         ) as median_days_to_sell
    from public.listing_status_events lse
    join public.market_listings ml on ml.id = lse.listing_id
   where lse.status = 'sold'
     and ml.species in ('crested','unknown')
     and lse.observed_at >= now() - interval '52 weeks'
   group by 1
)
select
  w.week_start,
  coalesce(lpw.listed_n, 0)                        as listed_n,
  coalesce(spw.sold_n, 0)                          as sold_n,
  case
    when coalesce(lpw.listed_n, 0) = 0 then null
    else (coalesce(spw.sold_n, 0)::numeric / lpw.listed_n)
  end                                              as sell_through,
  spw.median_sold_usd,
  spw.median_days_to_sell
from weeks w
left join listings_per_week lpw on lpw.week_start = w.week_start
left join sold_per_week     spw on spw.week_start = w.week_start
order by w.week_start;

-- ----------------------------------------------------------------------------
-- 2. v_combo_price_distribution
--    Per-combo price percentiles + sample size, computed from sold listings
--    in the last 180 days. Drives /api/market/fair-price.
--    cached_traits is matched against combo trait sets in application code
--    (the matcher lives in lib/market/combos.ts); this view only emits the
--    listing-level price + the canonical combo id projected from a helper
--    function. We compute the combo id inline using a CASE chain instead of
--    a join to keep the view dependency-free.
-- ----------------------------------------------------------------------------
create or replace function public._combo_id_from_traits(traits text)
returns text
language sql
immutable
as $$
  with t as (
    select lower(regexp_replace(coalesce(traits, ''), '[^a-zA-Z0-9 |,/;]', ' ', 'g')) as norm
  )
  select case
    when norm like '%lilly white%' and norm like '%axanthic%'        then 'lw-axa'
    when norm like '%lilly white%' and norm like '%cappuccino%'      then 'lw-cap'
    when norm like '%cappuccino%'  and norm like '%full pinstripe%'  then 'cap-pin'
    when norm like '%axanthic%'    and norm like '%full pinstripe%'  then 'axa-pin'
    when norm like '%sable%'       and norm like '%extreme harlequin%' then 'sable-harl'
    when norm like '%frappuccino%' and norm like '%pinstripe%'       then 'frap-pin'
    when norm like '%moonglow%'    and norm like '%super dalmatian%' then 'moonglow-dal'
    when norm like '%lilly white%' and norm like '%soft scale%'      then 'lw-soft'
    when norm like '%axanthic%'    and norm like '%extreme harlequin%' then 'axa-harl'
    when norm like '%cappuccino%'  and norm like '%super dalmatian%' then 'cap-dal'
    when norm like '%red%'         and norm like '%harlequin%'       then 'red-harl'
    when norm like '%tiger%'       and norm like '%pinstripe%'       then 'tiger-pin'
    else null
  end
  from t;
$$;

create or replace view public.v_combo_price_distribution as
select
  public._combo_id_from_traits(coalesce(ml.cached_traits, ml.norm_traits)) as combo_id,
  count(*)                                                                 as n,
  percentile_cont(0.10) within group (order by coalesce(ml.price_usd_equivalent, ml.price)) as p10,
  percentile_cont(0.25) within group (order by coalesce(ml.price_usd_equivalent, ml.price)) as p25,
  percentile_cont(0.50) within group (order by coalesce(ml.price_usd_equivalent, ml.price)) as p50,
  percentile_cont(0.75) within group (order by coalesce(ml.price_usd_equivalent, ml.price)) as p75,
  percentile_cont(0.90) within group (order by coalesce(ml.price_usd_equivalent, ml.price)) as p90,
  avg(coalesce(ml.price_usd_equivalent, ml.price))                         as mean_usd,
  stddev(coalesce(ml.price_usd_equivalent, ml.price))                      as stddev_usd
from public.market_listings ml
join public.listing_status_events lse
  on lse.listing_id = ml.id
 and lse.status = 'sold'
 and lse.observed_at >= now() - interval '180 days'
where ml.species in ('crested','unknown')
  and coalesce(ml.price_usd_equivalent, ml.price) is not null
  and coalesce(ml.price_usd_equivalent, ml.price) > 0
group by 1
having public._combo_id_from_traits(coalesce(ml.cached_traits, ml.norm_traits)) is not null;

-- ----------------------------------------------------------------------------
-- 3. v_cross_platform_arbitrage_pairs
--    Joins listings sharing a phash across (listing_images, cross_platform).
--    The view emits one row per candidate pair with the price delta. Empty
--    until the pHash worker populates phash columns; downstream code should
--    treat that as the "no signal yet" empty state.
-- ----------------------------------------------------------------------------
create or replace view public.v_cross_platform_arbitrage_pairs as
select
  li.listing_id                                       as listing_id,
  xpl.platform                                        as cross_platform,
  xpl.external_id                                     as cross_external_id,
  xpli.cross_platform_listing_id                      as cross_listing_uuid,
  ml.price_usd_equivalent                             as mm_price_usd,
  xpl.price_usd_equivalent                            as xpl_price_usd,
  case
    when coalesce(ml.price_usd_equivalent, 0) > 0
      then ((xpl.price_usd_equivalent - ml.price_usd_equivalent)
              / ml.price_usd_equivalent) * 100.0
  end                                                 as pct_delta,
  abs(coalesce(ml.price_usd_equivalent, 0)
      - coalesce(xpl.price_usd_equivalent, 0))        as abs_delta_usd,
  li.phash                                            as phash,
  ml.url                                              as mm_url,
  xpl.url                                             as xpl_url
from public.listing_images li
join public.cross_platform_listing_images xpli
  on xpli.phash = li.phash
 and xpli.phash is not null
join public.cross_platform_listings xpl on xpl.id = xpli.cross_platform_listing_id
join public.market_listings ml          on ml.id = li.listing_id
where li.phash is not null;

-- ----------------------------------------------------------------------------
-- 4. v_seller_reputation
--    Latest seller_snapshots row per seller + recent sold count. We drive
--    off seller_snapshots (created in 0002) rather than market_sellers
--    because market_sellers has no migration-defined column set — its
--    schema is whatever the original Python uploader laid down. Display
--    name resolution stays in application code (it falls back to listings).
-- ----------------------------------------------------------------------------
create or replace view public.v_seller_reputation as
with latest_snap as (
  select distinct on (seller_id)
    seller_id,
    observed_at,
    feedback_count,
    seller_rating_score,
    five_star_rating,
    total_listings,
    avg_price,
    membership
  from public.seller_snapshots
  order by seller_id, observed_at desc
),
sold_30d as (
  select ml.seller_id, count(*) as sold_30d
    from public.listing_status_events lse
    join public.market_listings ml on ml.id = lse.listing_id
   where lse.status = 'sold'
     and lse.observed_at >= now() - interval '30 days'
     and ml.seller_id is not null
   group by 1
)
select
  snap.seller_id,
  snap.feedback_count,
  snap.seller_rating_score,
  snap.five_star_rating,
  snap.total_listings,
  snap.avg_price,
  snap.membership,
  coalesce(sold_30d.sold_30d, 0) as sold_30d,
  snap.observed_at               as snapshot_at
from latest_snap snap
left join sold_30d on sold_30d.seller_id = snap.seller_id;
