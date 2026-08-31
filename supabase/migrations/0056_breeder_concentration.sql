-- ============================================================================
-- Geck Data 0056: seller concentration over the tracked live catalogue, for
-- the Breeders-tab share chart (the full-page form of the preview's market
-- share panel).
--
-- Aggregated server-side rather than by pulling every attributed row to the
-- client, so the counts never hit PostgREST's row cap and the totals stay
-- exact. Returns json (top-N rows plus the scalars the panel labels itself
-- with) in one round trip.
--
-- Honesty note carried by the shape: `total_attributed` is live listings that
-- carry a seller, and `live_total` is all live listings. Seller identity sits
-- on only ~12% of the catalogue because MorphMarket's public API hides the
-- owner on the rest, so every share is a share of the attributed pool and the
-- widget states that coverage.
-- ============================================================================

create or replace function public.v_breeder_concentration(top_n integer default 12)
returns json
language sql
stable
set search_path to 'public'
as $function$
  with attributed as (
    select seller_id, seller_name
    from public.market_listings
    where current_status = 'live' and seller_id is not null
  ),
  tally as (
    select seller_id, max(seller_name) as name, count(*) as listings
    from attributed
    group by seller_id
  ),
  tot as (
    select
      (select count(*) from attributed) as total_attributed,
      (select count(*) from tally)      as seller_count,
      (select count(*) from public.market_listings where current_status = 'live')
        as live_total
  ),
  ranked as (
    select
      seller_id,
      coalesce(name, seller_id) as name,
      listings,
      round(100.0 * listings / nullif((select total_attributed from tot), 0), 1)
        as share_pct
    from tally
    order by listings desc
  )
  select json_build_object(
    'rows', coalesce(
      (select json_agg(json_build_object(
          'id', seller_id,
          'name', name,
          'listings', listings,
          'sharePct', share_pct))
       from (select * from ranked limit greatest(coalesce(top_n, 12), 1)) r),
      '[]'::json),
    'totalAttributed', (select total_attributed from tot),
    'sellerCount',     (select seller_count from tot),
    'liveTotal',       (select live_total from tot),
    'top10Pct', coalesce(
      (select round(sum(share_pct), 1)
       from (select share_pct from ranked limit 10) t), 0)
  );
$function$;
