-- Gallery events from the browser extension carry image URLs only; the
-- binaries are fetched server-side during /api/ingest processing. This lets
-- listing_images rows exist in a URL-only state (storage_path / file_name
-- nullable, image_url populated) while still enforcing de-duplication per
-- (listing_id, image_url).

alter table public.listing_images
  add column if not exists image_url text;

alter table public.listing_images
  alter column storage_path drop not null,
  alter column file_name drop not null;

-- Partial unique index so URL-only rows de-duplicate per listing without
-- interfering with legacy rows that only have storage_path.
create unique index if not exists idx_listing_images_listing_image_url
  on public.listing_images (listing_id, image_url)
  where image_url is not null;

-- Fast lookup for a future hydrate endpoint that walks URL-only rows.
create index if not exists idx_listing_images_pending_hydrate
  on public.listing_images (listing_id)
  where storage_path is null and image_url is not null;
