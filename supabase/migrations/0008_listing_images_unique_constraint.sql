-- 0007 created a partial unique index on (listing_id, image_url) to de-dupe
-- URL-only rows coming from gallery events. It worked for queries but
-- PostgREST's upsert with `on_conflict=listing_id,image_url` can't infer
-- partial indexes — ON CONFLICT requires either a matching unique CONSTRAINT
-- or a full (non-partial) unique index. The result was every listingImage
-- event failing at upsert with "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification", so no rows ever landed.
--
-- Swap to a real unique constraint. PostgreSQL treats NULLs as distinct by
-- default, so legacy rows where image_url is NULL still coexist freely.

drop index if exists public.idx_listing_images_listing_image_url;

alter table public.listing_images
  add constraint listing_images_listing_image_url_key
  unique (listing_id, image_url);
