-- ============================================================================
-- Geck Data 0055: the regional heatmap (and the arbitrage tab it feeds) draw
-- from every combo, and price on asks where sold data is absent.
--
-- v_regional_heatmap had the same blind spot the combo rollup did before 0053:
-- it resolved traits through combo_match, so only the 8 curated combos ever
-- reached the /market Regional heatmap and the Arbitrage tab. And its sold
-- median came from listing_status_events (92 rows from one week), so it was
-- null in almost every cell, which left the ask-vs-region arbitrage view
-- empty because that view keyed off the sold median.
--
-- This rebuilds it on the same auto-discovery every other combo surface now
-- uses (expand each listing into its trait pairs), keeps region_of() as the
-- region source, and pulls the sold median from v_sold_reconciled (migration
-- 0045) so a cell carries a sold figure wherever a reconciled sale in that
-- region exists. The ask median is the live median, which is populated
-- wherever a region is.
--
-- The honest limit is region coverage, not the combos: region_of() resolves
-- only listings whose seller carries a mappable location, which today is about
-- 15% of the catalogue and splits US / CA only. So the heatmap lights two
-- columns, and the arbitrage tab (0056 on the read side switches it to an
-- asking-price basis) surfaces the ~7 combos that appear in both. That is the
-- real picture; it widens on its own as seller-location coverage grows.
--
-- Return shape is unchanged, so fetchRegionalHeatmap and fetchArbitrage keep
-- working. Redundant pairs are dropped, group lots excluded, cells floored at
-- 2 live listings; ~500 rows, clear of the PostgREST cap.
-- ============================================================================

create or replace function public.v_regional_heatmap(window_days integer)
returns table (
  combo_name        text,
  region            text,
  n                 integer,
  median_sold       numeric,
  median_ask        numeric,
  confidence_score  integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select timezone('UTC', now())
      - make_interval(days => least(greatest(coalesce(window_days, 365), 1), 1825)) as window_since
  ),
  live_lt as (
    select
      ml.id,
      public.region_of(sel.seller_location) as region,
      ml.price_usd_equivalent as price,
      array_agg(distinct trim(both ' ' from t.t))
        filter (where length(trim(both ' ' from t.t)) between 2 and 60) as traits
    from public.market_listings ml
    left join public.market_sellers sel on sel.seller_id = ml.seller_id,
         lateral unnest(string_to_array(ml.cached_traits, ',')) t(t)
    where ml.cached_traits is not null
      and ml.species in ('crested', 'unknown')
      and not ml.is_group_lot
      and ml.current_status = 'live'
      and ml.price_usd_equivalent is not null
      and ml.price_usd_equivalent > 0
      and ml.price_usd_equivalent < 100000
      and public.region_of(sel.seller_location) is not null
    group by ml.id, public.region_of(sel.seller_location), ml.price_usd_equivalent
  ),
  live_pairs as (
    select
      least(lt.traits[i.i], lt.traits[j.j])    as ta,
      greatest(lt.traits[i.i], lt.traits[j.j]) as tb,
      lt.region, lt.price
    from live_lt lt,
         lateral generate_subscripts(lt.traits, 1) i(i),
         lateral generate_subscripts(lt.traits, 1) j(j)
    where i.i < j.j and array_length(lt.traits, 1) >= 2
  ),
  live_agg as (
    select ta, tb, region,
      count(*)::int as n,
      percentile_cont(0.5) within group (order by price) as median_ask
    from live_pairs group by ta, tb, region
  ),
  sold_lt as (
    select
      s.id,
      public.region_of(sel.seller_location) as region,
      s.price_usd_equivalent as price,
      array_agg(distinct trim(both ' ' from t.t))
        filter (where length(trim(both ' ' from t.t)) between 2 and 60) as traits
    from public.v_sold_reconciled s
    left join public.market_sellers sel on sel.seller_id = s.seller_id
    cross join bounds b,
         lateral unnest(string_to_array(s.cached_traits, ',')) t(t)
    where s.cached_traits is not null
      and not s.is_group_lot
      and s.price_usd_equivalent is not null
      and s.price_usd_equivalent > 0
      and s.price_usd_equivalent < 100000
      and s.sold_at >= b.window_since
      and public.region_of(sel.seller_location) is not null
    group by s.id, public.region_of(sel.seller_location), s.price_usd_equivalent
  ),
  sold_pairs as (
    select
      least(lt.traits[i.i], lt.traits[j.j])    as ta,
      greatest(lt.traits[i.i], lt.traits[j.j]) as tb,
      lt.region, lt.price
    from sold_lt lt,
         lateral generate_subscripts(lt.traits, 1) i(i),
         lateral generate_subscripts(lt.traits, 1) j(j)
    where i.i < j.j and array_length(lt.traits, 1) >= 2
  ),
  sold_agg as (
    select ta, tb, region,
      percentile_cont(0.5) within group (order by price) as median_sold
    from sold_pairs group by ta, tb, region
  )
  select
    (la.ta || ' x ' || la.tb) as combo_name,
    la.region,
    la.n,
    round(sa.median_sold::numeric, 2),
    round(la.median_ask::numeric, 2),
    least(99, greatest(1, round((20 + la.n * 5)::numeric)))::int
  from live_agg la
  left join sold_agg sa
    on sa.ta = la.ta and sa.tb = la.tb and sa.region = la.region
  where not public._traits_are_redundant(la.ta, la.tb)
    and la.n >= 2;
$$;

comment on function public.v_regional_heatmap(integer) is
  'Per (auto-discovered combo, region) live/sold medians. Combos are every trait pair (not the 8 combo_match knew); region is region_of(seller_location), which resolves only the ~15% of listings with a mappable seller location (US/CA today); sold median reads v_sold_reconciled. Redundant pairs and group lots excluded, cells floored at 2 live listings.';

revoke all on function public.v_regional_heatmap(integer) from public;
grant execute on function public.v_regional_heatmap(integer) to anon, authenticated, service_role;
