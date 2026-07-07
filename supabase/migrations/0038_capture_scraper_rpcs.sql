-- 0038 - Capture the three scraper RPCs that only existed in prod.
--
-- These functions were created by hand in the Supabase SQL editor back
-- in PR #48 (see the note in 0011_canonical_listings.sql) and were
-- never written down as migration files. The Python scrapers call all
-- three every run, so a database rebuilt from this folder would leave
-- the scrapers throwing on missing functions. The definitions below
-- were read verbatim from production via pg_get_functiondef on
-- 2026-07-07; applying this file to prod is a no-op by design
-- (CREATE OR REPLACE with identical bodies).
--
-- What each one does:
--   mark_unseen_listings_inactive(run_id): after a FULL catalog walk,
--     flips is_active off (and stamps sold_at) for every listing not
--     seen since that run started. Only the weekly resync calls this;
--     delta walks and smoke runs skip it so partial walks cannot rot
--     the catalog.
--   listings_needing_detail_scrape(days): the weekly detail scraper's
--     work queue - active listings never detail-scraped or stale.
--   listings_needing_image_download(): the weekly image downloader's
--     work queue - active listings with a CloudFront primary image URL
--     not yet mirrored to Storage.

CREATE OR REPLACE FUNCTION public.mark_unseen_listings_inactive(target_run_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE listings
    SET is_active = FALSE,
        sold_at = NOW()
    WHERE is_active = TRUE
      AND last_seen_at < (
          SELECT started_at FROM scrape_runs WHERE id = target_run_id
      );
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.listings_needing_detail_scrape(stale_after_days integer DEFAULT 7)
 RETURNS TABLE(listing_id text, listing_url text, reason text)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT l.listing_id, l.listing_url,
        CASE
            WHEN l.description IS NULL THEN 'never_scraped_details'
            ELSE 'stale'
        END AS reason
    FROM listings l
    WHERE l.is_active = TRUE
      AND (
          l.description IS NULL
          OR l.last_updated_at < NOW() - (stale_after_days || ' days')::INTERVAL
      );
$function$;

CREATE OR REPLACE FUNCTION public.listings_needing_image_download()
 RETURNS TABLE(listing_id text, primary_image_url text)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT l.listing_id, l.primary_image_url
    FROM listings l
    WHERE l.is_active = TRUE
      AND l.primary_image_url IS NOT NULL
      AND l.primary_image_url LIKE 'https://%cloudfront%';
$function$;
