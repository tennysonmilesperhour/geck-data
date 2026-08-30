-- ============================================================================
-- Geck Data 0053: the combo lists draw from every combo, not a basket of 8.
--
-- v_combo_rollups feeds the three primary combo surfaces: the landing page's
-- "What's hot", the hero's "deepest combo", and the market dashboard's ranked
-- combos table. It resolved each listing's traits through combo_match(), a
-- curated recognizer that only knows the 12 HIGH_VALUE_COMBOS. On production
-- that matched 338 of 9,930 priced live listings (3.4%) into just 8 combos, so
-- 96.6% of the catalogue was invisible to every one of those surfaces while
-- the auto-discovery machinery built for the index (combo_index_daily,
-- combo_maturity_baselines, v_combo_index_summary at 2,473 rows) sat unused
-- beside it.
--
-- This rebuilds the rollup on the same auto-discovery every other combo
-- surface already uses: expand each listing into its 2-trait pairs and group.
-- The return shape is unchanged, so every caller keeps working; it just sees
-- the full universe. The pair id is emitted as "Trait A x Trait B", the exact
-- form combo_index_daily.combo_id uses, so the ranked table's sparklines and
-- the /combo/<slug> links resolve for every combo instead of only the curated
-- dozen.
--
-- Two honesty carry-overs from the rest of the audit:
--   * the sold side reads v_sold_reconciled (migration 0045), the 2,932-row
--     pool, not the 92-row listing_status_events combo_match used, so sold
--     counts and medians reflect the sales we actually have.
--   * redundant pairs (Extreme Harlequin x Harlequin) are dropped via the
--     0046 test, and group lots are excluded on both sides.
--
-- Bounded deliberately: only pairs with real depth are returned, ordered by
-- depth, capped at 600 rows. That keeps the response clear of PostgREST's
-- ~1,000-row cap (where a silent truncation would drop combos as the
-- catalogue grows) while still covering every combo any surface ranks.
-- ============================================================================

create or replace function public.v_combo_rollups(window_days integer)
returns table (
  combo_name        text,
  sold_count        integer,
  live_count        integer,
  median_sold       numeric,
  median_ask        numeric,
  spread_pct        numeric,
  avg_days_to_sell  numeric,
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
      ml.price_usd_equivalent as price,
      array_agg(distinct trim(both ' ' from t.t))
        filter (where length(trim(both ' ' from t.t)) between 2 and 60) as traits
    from public.market_listings ml,
         lateral unnest(string_to_array(ml.cached_traits, ',')) t(t)
    where ml.cached_traits is not null
      and ml.species in ('crested', 'unknown')
      and not ml.is_group_lot
      and ml.current_status = 'live'
      and ml.price_usd_equivalent is not null
      and ml.price_usd_equivalent > 0
      and ml.price_usd_equivalent < 100000
    group by ml.id, ml.price_usd_equivalent
  ),
  live_pairs as (
    select
      least(lt.traits[i.i], lt.traits[j.j])    as ta,
      greatest(lt.traits[i.i], lt.traits[j.j]) as tb,
      lt.price
    from live_lt lt,
         lateral generate_subscripts(lt.traits, 1) i(i),
         lateral generate_subscripts(lt.traits, 1) j(j)
    where i.i < j.j and array_length(lt.traits, 1) >= 2
  ),
  live_agg as (
    select ta, tb,
      count(*)::int as live_count,
      percentile_cont(0.5) within group (order by price) as median_ask
    from live_pairs group by ta, tb
  ),
  sold_lt as (
    select
      s.id,
      s.price_usd_equivalent as price,
      s.days_to_sell,
      array_agg(distinct trim(both ' ' from t.t))
        filter (where length(trim(both ' ' from t.t)) between 2 and 60) as traits
    from public.v_sold_reconciled s
    cross join bounds b,
         lateral unnest(string_to_array(s.cached_traits, ',')) t(t)
    where s.cached_traits is not null
      and not s.is_group_lot
      and s.price_usd_equivalent is not null
      and s.price_usd_equivalent > 0
      and s.price_usd_equivalent < 100000
      and s.sold_at >= b.window_since
    group by s.id, s.price_usd_equivalent, s.days_to_sell
  ),
  sold_pairs as (
    select
      least(lt.traits[i.i], lt.traits[j.j])    as ta,
      greatest(lt.traits[i.i], lt.traits[j.j]) as tb,
      lt.price, lt.days_to_sell
    from sold_lt lt,
         lateral generate_subscripts(lt.traits, 1) i(i),
         lateral generate_subscripts(lt.traits, 1) j(j)
    where i.i < j.j and array_length(lt.traits, 1) >= 2
  ),
  sold_agg as (
    select ta, tb,
      count(*)::int as sold_count,
      percentile_cont(0.5) within group (order by price) as median_sold,
      avg(days_to_sell) as avg_days
    from sold_pairs group by ta, tb
  ),
  merged as (
    select
      coalesce(l.ta, s.ta) as ta,
      coalesce(l.tb, s.tb) as tb,
      coalesce(l.live_count, 0) as live_count,
      coalesce(s.sold_count, 0) as sold_count,
      l.median_ask, s.median_sold, s.avg_days
    from live_agg l
    full outer join sold_agg s on s.ta = l.ta and s.tb = l.tb
  )
  select
    (ta || ' x ' || tb) as combo_name,
    sold_count,
    live_count,
    round(median_sold::numeric, 2),
    round(median_ask::numeric, 2),
    case when median_sold is null or median_sold = 0 then null
         else round((((median_ask - median_sold) / median_sold) * 100)::numeric, 1) end,
    round(avg_days::numeric, 1),
    least(99, greatest(1, round((20 + sold_count * 2 + live_count * 0.5)::numeric)))::int
  from merged
  where not public._traits_are_redundant(ta, tb)
    and (live_count >= 2 or sold_count >= 2)
  order by (live_count + sold_count) desc
  limit 600;
$$;

comment on function public.v_combo_rollups(integer) is
  'Per-combo live/sold rollup over auto-discovered trait pairs (every 2-trait combination in the catalogue), not the 12 curated combos combo_match knew. Sold side reads v_sold_reconciled. Redundant pairs and group lots excluded; depth-floored and capped at the 600 deepest combos to stay under the PostgREST response cap.';

revoke all on function public.v_combo_rollups(integer) from public;
grant execute on function public.v_combo_rollups(integer) to anon, authenticated, service_role;
