-- ============================================================================
-- Geck Data 0049: a price baseline made of the same kind of animal as the
-- listing being measured against it.
--
-- The landing page called a listing an "opportunity" when it sat 25% under its
-- combo's median asking price. That baseline came from v_combo_rollups over a
-- 365 day window, which applies no freshness filter, keeps multi-animal lots
-- in, and pools every age class together. Checked against production, the
-- result was not a discount signal at all: the strongest "deals" on the page
-- were babies and juveniles measured against a median that included adults.
-- A $60 juvenile against a $350 all-ages median is not an 83% discount, it is
-- a young animal priced like a young animal. The real medians separate hard:
-- Baby $190, Juvenile $200, Subadult $350, Adult $350.
--
-- So the baseline is cut per (combo, maturity), and five filters decide
-- whether a cell is allowed to price anything at all:
--
--   fresh      only rows the ingest re-confirmed inside fresh_hours. A stale
--              ask describes a market that may not exist any more, and the
--              listing being judged is fresh by construction.
--   no lots    a wholesale lot's price covers several geckos.
--   no auctions a live auction's price is the current bid, which opens low by
--              design. Left in, auctions are most of the deepest "discounts".
--   breadth    at least 5 fresh asks from at least 3 distinct sellers, so one
--              seller's pricing cannot become the market it is under.
--   distinct   the redundancy test from 0046, so pairs like Extreme Harlequin
--              x Harlequin never set a price. Those two traits are really one
--              trait, and the "combo" is an artefact of the tokenizer.
--
-- The bar is applied here rather than in the caller, for two reasons: a cell
-- that may not price anything is not a baseline, and returning all 1,938 cells
-- put the result one row under PostgREST's response cap, where a silent
-- truncation would have quietly dropped baselines on a growing catalogue.
--
-- The honest cost of all this: of 1,938 (combo, maturity) cells currently in
-- the catalogue, 34 clear the bar. Every other listing gets no baseline and
-- makes no claim, which is the correct outcome for a weekly ingest holding a
-- few hundred freshly confirmed asks.
-- ============================================================================

drop function if exists public.combo_fresh_medians(integer, integer);
-- An earlier shape of this function took only (fresh_hours, window_days).
-- Left in place it would overload the four-argument version below, and a
-- PostgREST call naming just those two arguments resolves by name, so the
-- request would fail as ambiguous rather than pick one.
drop function if exists public.combo_maturity_baselines(integer, integer);

create or replace function public.combo_maturity_baselines(
  fresh_hours integer default 48,
  window_days integer default 365,
  min_fresh integer default 5,
  min_sellers integer default 3
)
returns table (
  combo_id          text,
  trait_a           text,
  trait_b           text,
  maturity          text,
  n_fresh           bigint,
  n_fresh_sellers   bigint,
  median_fresh_ask  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      timezone('UTC', now())
        - make_interval(hours => least(greatest(coalesce(fresh_hours, 48), 1), 8760)) as fresh_since,
      timezone('UTC', now())
        - make_interval(days => least(greatest(coalesce(window_days, 365), 1), 1825)) as window_since
  ),
  lt as (
    select
      ml.id,
      ml.seller_id,
      ml.price_usd_equivalent as price,
      ml.maturity,
      array_agg(distinct trim(both ' ' from t.t))
        filter (where length(trim(both ' ' from t.t)) between 2 and 60) as traits
    from public.market_listings ml
    cross join bounds b,
         lateral unnest(string_to_array(ml.cached_traits, ',')) t(t)
    where ml.cached_traits is not null
      and ml.maturity is not null
      and ml.species in ('crested', 'unknown')
      and not ml.is_group_lot
      and not coalesce(ml.is_auction, false)
      and ml.current_status = 'live'
      and ml.last_seen_at >= b.fresh_since
      and ml.price_usd_equivalent is not null
      and ml.price_usd_equivalent > 0
      and ml.price_usd_equivalent < 100000
      and coalesce(ml.first_listed_at, ml.first_seen_at) >= b.window_since
    group by ml.id, ml.seller_id, ml.price_usd_equivalent, ml.maturity
  ),
  pairs as (
    select
      (least(lt.traits[i.i], lt.traits[j.j]) || ' x ' || greatest(lt.traits[i.i], lt.traits[j.j])) as combo_id,
      least(lt.traits[i.i], lt.traits[j.j])    as trait_a,
      greatest(lt.traits[i.i], lt.traits[j.j]) as trait_b,
      lt.maturity, lt.id, lt.seller_id, lt.price
    from lt,
         lateral generate_subscripts(lt.traits, 1) i(i),
         lateral generate_subscripts(lt.traits, 1) j(j)
    where i.i < j.j
      and array_length(lt.traits, 1) >= 2
  )
  select
    combo_id,
    min(trait_a),
    min(trait_b),
    maturity,
    count(*)::bigint,
    count(distinct seller_id)::bigint,
    round(percentile_cont(0.5) within group (order by price)::numeric, 2)
  from pairs
  group by combo_id, maturity
  having count(*) >= greatest(coalesce(min_fresh, 5), 2)
     and count(distinct seller_id) >= greatest(coalesce(min_sellers, 3), 2)
     and not public._traits_are_redundant(min(trait_a), min(trait_b));
$$;

comment on function public.combo_maturity_baselines(integer, integer, integer, integer) is
  'Median asking price per (trait combo, maturity) over freshly re-confirmed live single-animal listings, excluding group lots and auctions. Only cells with real depth are returned: at least min_fresh asks from at least min_sellers distinct sellers, and never a pair whose two traits are redundant with each other.';

revoke all on function public.combo_maturity_baselines(integer, integer, integer, integer) from public;
grant execute on function public.combo_maturity_baselines(integer, integer, integer, integer) to anon, authenticated, service_role;
