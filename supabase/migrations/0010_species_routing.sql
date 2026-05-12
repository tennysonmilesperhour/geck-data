-- ============================================================================
-- Geck Data 0010: species routing.
--
-- Geck Inspect is crested-gecko-FIRST. The Eye in the Sky extension scrapes
-- whatever MorphMarket page the user happens to view (cresteds, leopards,
-- gargoyles, leachies, snakes, etc.), so without filtering, non-crested
-- listings pollute the analytics surfaces the app shows.
--
-- This migration adds a species column on every ingest-facing table and a
-- private archive Storage bucket. The legacy adapter detects the species
-- from the MorphMarket URL path at ingest time and tags the row; non-crested
-- image bytes route to the archive bucket so the public `listing-images`
-- bucket stays crested-only.
--
-- We do NOT delete or move non-crested rows. They live in the same tables
-- with species='leopard'/'gargoyle'/etc. so a future leopard product (or
-- ad-hoc analysis) has the data on hand; the read-side just filters
-- WHERE species = 'crested'.
--
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. species columns on the main ingest tables
-- ----------------------------------------------------------------------------
alter table public.market_listings
  add column if not exists species text default 'unknown';
create index if not exists idx_market_listings_species
  on public.market_listings(species);

alter table public.cross_platform_listings
  add column if not exists species text default 'unknown';
create index if not exists idx_cross_platform_listings_species
  on public.cross_platform_listings(species);

alter table public.listing_images
  add column if not exists species text default 'unknown';
create index if not exists idx_listing_images_species
  on public.listing_images(species);

-- external_reference_images already has a `species` column from migration 0009.
-- morph_taxonomy already has a `species` column from migration 0009.

-- ----------------------------------------------------------------------------
-- 2. archive-listing-images Storage bucket
--    Private (service role only) because nothing user-facing reads it today.
--    Same internal path convention as listing-images: {listing_id}/{hash}.{ext}.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('archive-listing-images', 'archive-listing-images', false)
on conflict (id) do nothing;

-- (No public-read policy on archive-listing-images; service role only.)
