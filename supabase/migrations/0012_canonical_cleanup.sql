-- ============================================================================
-- 0012 — Clean up legacy bare-numeric market_listings rows + ghost sellers
--
-- After 0011 enabled RLS and the canonical dual-write established the
-- mm_-prefixed id convention, 21 bare-numeric market_listings rows from
-- the 2026-04 bulk Python upload remained as dead-letter placeholders.
-- 16 of them anchored listing_images uploaded through the geck-data UI,
-- 3 anchored legacy price_history rows, and 18 of the 21 collided with
-- mm_-prefixed siblings created by the canonical backfill — leaving 3
-- hand-uploaded images on listing 3615035 unreachable from the public
-- listing page because they were attached to the bare id.
--
-- This migration:
--
--   1. Inserts mm_-prefixed siblings for the 3 bare rows that lacked one
--      (preserving whatever data they had — typically just `price`).
--   2. Re-points listing_images.listing_id from bare to mm_-prefixed (68 rows).
--   3. Re-points price_history.listing_id likewise (3 rows).
--   4. Deletes all 21 bare market_listings rows.
--   5. Deletes the 4 ghost market_sellers rows whose seller_id is a
--      MorphMarket page-section placeholder ('random_stores', '_own',
--      'search_index', 'featured_stores') rather than a real seller.
--
-- Pre-condition: a sane bare row count (<=100) to guard against running
-- this in an unexpected state. Post-condition: 0 bare rows and 0 ghost
-- sellers remain. Idempotent — a second run finds 0 bare rows and is
-- a no-op.
-- ============================================================================

do $$
declare
  bare_count int;
  ghost_count int;
begin
  select count(*) into bare_count
    from public.market_listings where id not like 'mm_%';
  if bare_count = 0 then
    raise notice '0012: no bare-numeric market_listings rows found — already cleaned.';
    return;
  end if;
  if bare_count > 100 then
    raise exception
      '0012: refusing to run with % bare rows (expected <= 100). Investigate first.',
      bare_count;
  end if;
  select count(*) into ghost_count from public.market_sellers
    where seller_name is null
      and seller_id in ('random_stores','_own','search_index','featured_stores');
  raise notice '0012 pre-check: % bare market_listings rows, % ghost sellers.',
    bare_count, ghost_count;
end$$;

-- 1. Create mm_-prefixed siblings for any bare rows that lack one.
--    Preserves whatever data the bare row had (typically just `price`).
insert into public.market_listings (id, price, source, imported_at)
select
  'mm_' || id,
  price,
  coalesce(source, 'manual_legacy'),
  now()
from public.market_listings
where id not like 'mm_%'
  and not exists (
    select 1 from public.market_listings p
    where p.id = 'mm_' || public.market_listings.id
  )
on conflict (id) do nothing;

-- 2. Re-point listing_images from bare ids to mm_-prefixed.
update public.listing_images
set listing_id = 'mm_' || listing_id
where listing_id in (
  select id from public.market_listings where id not like 'mm_%'
);

-- 3. Re-point price_history likewise.
update public.price_history
set listing_id = 'mm_' || listing_id
where listing_id in (
  select id from public.market_listings where id not like 'mm_%'
);

-- 4. Delete the bare rows now that nothing references them.
delete from public.market_listings where id not like 'mm_%';

-- 5. Delete the ghost market_sellers rows.
delete from public.market_sellers
where seller_id in ('random_stores','_own','search_index','featured_stores')
  and seller_name is null;

do $$
declare
  bare_count int;
  ghost_count int;
begin
  select count(*) into bare_count
    from public.market_listings where id not like 'mm_%';
  if bare_count <> 0 then
    raise exception
      '0012 post-check: % bare-numeric market_listings rows remain after cleanup.',
      bare_count;
  end if;
  select count(*) into ghost_count from public.market_sellers
    where seller_id in ('random_stores','_own','search_index','featured_stores');
  if ghost_count <> 0 then
    raise exception
      '0012 post-check: % ghost market_sellers rows remain after cleanup.',
      ghost_count;
  end if;
end$$;
