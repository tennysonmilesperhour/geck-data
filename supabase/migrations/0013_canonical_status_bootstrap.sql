-- ============================================================================
-- 0013 — Bootstrap current_status + listing_status_events from scraper data
--
-- The /market dashboard views from migration 0005 (v_combo_rollups,
-- v_regional_heatmap, v_market_index) read market_listings.current_status
-- ('sold' / 'live') and listing_status_events to compute rollups. The Eye
-- in the Sky extension populates these columns as it observes listings;
-- the Decodo scraper writes is_active / is_sold (via the canonical
-- dual-write in lib/canonical.py).
--
-- This migration translates the scraper's signal into the schema the views
-- expect:
--
--   1. current_status = 'sold' when is_sold = true, else 'live' (only when
--      currently NULL — leaves extension-set values untouched).
--   2. Synthesizes one listing_status_events row per sold listing that
--      doesn't already have one, using last_seen_at as the observation time
--      and days_since_first_seen as the listing's lifespan.
--
-- Going forward the canonical helper in scripts/lib/canonical.py sets
-- current_status on every upsert, so this only needs to run once for the
-- existing backfill. Re-running is idempotent (UPDATE only NULLs, INSERT
-- skips already-recorded events).
-- ============================================================================

-- 1. Set current_status from is_sold
update public.market_listings
set current_status = case when is_sold then 'sold' else 'live' end
where current_status is null;

-- 2. Synthesize sold events
insert into public.listing_status_events
  (id, listing_id, status, observed_at, source, days_since_first_seen)
select
  gen_random_uuid(),
  ml.id,
  'sold',
  coalesce(ml.last_seen_at, ml.imported_at, now()),
  coalesce(ml.source, 'scraper'),
  greatest(0,
    (extract(epoch from coalesce(ml.last_seen_at, now())
      - coalesce(ml.first_seen_at, ml.imported_at, now())) / 86400)::int
  )
from public.market_listings ml
where ml.current_status = 'sold'
  and not exists (
    select 1 from public.listing_status_events lse
    where lse.listing_id = ml.id and lse.status = 'sold'
  );
