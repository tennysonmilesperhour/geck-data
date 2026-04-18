-- ============================================================================
-- Geck Inspect / Geck Data — initial schema additions
--
-- Assumes market_listings and market_sellers already exist (from the earlier
-- Python upload). This migration:
--   1) Adds listing_images table
--   2) Creates two Storage buckets: listing-images (public) and raw-uploads (private)
--   3) Enables RLS on the market_* tables and exposes them as public-read
--   4) Adds storage policies so the dashboard can read images publicly,
--      but uploads always go through the server (service role).
--
-- Paste this whole file into Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run; uses IF NOT EXISTS / ON CONFLICT throughout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. listing_images table
-- ----------------------------------------------------------------------------
create table if not exists public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id text references public.market_listings(id) on delete set null,
  storage_bucket text not null default 'listing-images',
  storage_path text not null,
  file_name text not null,
  file_size bigint,
  mime_type text,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create index if not exists idx_listing_images_listing_id
  on public.listing_images(listing_id);

create index if not exists idx_listing_images_uploaded_at
  on public.listing_images(uploaded_at desc);

-- ----------------------------------------------------------------------------
-- 2. Storage buckets
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('raw-uploads', 'raw-uploads', false)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. RLS on market tables
--    Dashboard reads with the anon key — needs public SELECT.
--    Writes only happen through the server-side API route using the service
--    role key, which bypasses RLS, so we don't add public write policies.
-- ----------------------------------------------------------------------------
alter table public.market_listings enable row level security;
alter table public.market_sellers  enable row level security;
alter table public.listing_images  enable row level security;

drop policy if exists "public read market_listings" on public.market_listings;
create policy "public read market_listings" on public.market_listings
  for select using (true);

drop policy if exists "public read market_sellers" on public.market_sellers;
create policy "public read market_sellers" on public.market_sellers
  for select using (true);

drop policy if exists "public read listing_images" on public.listing_images;
create policy "public read listing_images" on public.listing_images
  for select using (true);

-- ----------------------------------------------------------------------------
-- 4. Storage policies
--    listing-images: anyone can read (bucket is public, but objects also need
--                    a SELECT policy on storage.objects)
--    raw-uploads:    nothing public; only the service role touches it
-- ----------------------------------------------------------------------------
drop policy if exists "public read listing-images" on storage.objects;
create policy "public read listing-images" on storage.objects
  for select using (bucket_id = 'listing-images');

-- (no policies on raw-uploads — service role only)
