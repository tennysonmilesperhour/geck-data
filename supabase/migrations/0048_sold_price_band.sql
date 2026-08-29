-- ============================================================================
-- Geck Data 0048: give the valuation engine its comps back.
--
-- /whats-it-worth is the closest thing this site has to a product, and it was
-- pricing animals off f_price_band_for_traits, which joins ONLY
-- listing_status_events where status = 'sold'. That is 92 rows, all observed
-- between 2026-05-11 and 2026-05-14. A Lilly White subadult lookup returned a
-- band built from 13 comps, every one of them from four days in May, under a
-- heading that said "recent".
--
-- Meanwhile 2,840 inferred sales from 2026-05-17 to 2026-06-07 sat unused
-- (see 0045). Those are a different kind of evidence: the catalogue walk
-- stopped seeing the listing, so a sale is inferred rather than observed. The
-- audit is explicit that the two pools must not be silently merged, so this
-- returns them together but counts them separately and reports the date range,
-- letting the caller show the basis and decide what to trust.
--
-- Both pools carry the same price caveat, which the UI has to keep saying:
-- the figure is the last asking price observed before the listing went away,
-- not a negotiated sale price. MorphMarket does not publish what changed
-- hands, and no amount of aggregation invents that.
--
-- Group lots are excluded: their price covers several animals.
--
-- The old function is left in place so nothing breaks mid-deploy.
-- ============================================================================

create or replace function public.sold_price_band(
  p_traits          text[],
  p_lookback_days   integer default 180,
  p_include_inferred boolean default true
)
returns table (
  n                bigint,
  n_captured       bigint,
  n_inferred       bigint,
  p10              numeric,
  p25              numeric,
  p50              numeric,
  p75              numeric,
  p90              numeric,
  mean_usd         numeric,
  newest_sold_at   timestamptz,
  oldest_sold_at   timestamptz,
  n_sellers        bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with matched as (
    select
      s.price_usd_equivalent as price_usd,
      s.sold_basis,
      s.sold_at,
      s.seller_id
    from public.v_sold_reconciled s
    where s.sold_at >= timezone('UTC', now())
      - make_interval(days => least(greatest(coalesce(p_lookback_days, 180), 1), 1825))
      and not s.is_group_lot
      and s.price_usd_equivalent is not null
      and s.price_usd_equivalent > 0
      and s.price_usd_equivalent < 100000
      and (p_include_inferred or s.sold_basis = 'captured_event')
      and (
        p_traits is null
        or cardinality(p_traits) = 0
        or not exists (
          select 1 from unnest(p_traits) t
          where coalesce(s.cached_traits, '') !~* ('(^|[|,;/ ])' || t || '($|[|,;/ ])')
        )
      )
  )
  select
    count(*)::bigint,
    count(*) filter (where sold_basis = 'captured_event')::bigint,
    count(*) filter (where sold_basis = 'inferred_unseen')::bigint,
    round(percentile_cont(0.10) within group (order by price_usd)::numeric, 2),
    round(percentile_cont(0.25) within group (order by price_usd)::numeric, 2),
    round(percentile_cont(0.50) within group (order by price_usd)::numeric, 2),
    round(percentile_cont(0.75) within group (order by price_usd)::numeric, 2),
    round(percentile_cont(0.90) within group (order by price_usd)::numeric, 2),
    round(avg(price_usd)::numeric, 2),
    max(sold_at),
    min(sold_at),
    count(distinct seller_id)::bigint
  from matched;
$$;

comment on function public.sold_price_band(text[], integer, boolean) is
  'Price band across BOTH sold pools for listings carrying every requested trait. Returns captured and inferred counts separately, plus the date range and seller breadth, so the caller can disclose what the band rests on. Prices are last observed asks, not negotiated sale prices. Group lots excluded.';

revoke all on function public.sold_price_band(text[], integer, boolean) from public;
grant execute on function public.sold_price_band(text[], integer, boolean) to anon, authenticated, service_role;
