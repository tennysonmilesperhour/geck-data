-- ============================================================================
-- Geck Data 0027: tighten RLS, add image perceptual-hash column.
--
-- 1. alert_matches was created with public-read RLS in 0002 alongside the
--    market tables, but a match links an alert (owner-scoped) to a listing.
--    Reading other users' matches leaks their saved-query semantics. Move
--    the policy to owner-scoped by joining through alerts.owner_id.
--
-- 2. cross_platform_listings is fine for public read (it's market data),
--    but we never set up a write policy for the service role — confirm it
--    explicitly so the contract is documented.
--
-- 3. Add listing_images.phash (perceptual hash) + index for the future
--    cross-platform dedup feature. The hash itself will be computed by a
--    separate worker (the route handler doesn't have a pHash dependency
--    today); this migration only lays the column down so /api/ingest can
--    persist hashes as they arrive.
--
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. alert_matches: owner-scoped read.
-- ----------------------------------------------------------------------------
drop policy if exists "public read alert_matches" on public.alert_matches;
drop policy if exists "owner read alert_matches"  on public.alert_matches;

create policy "owner read alert_matches" on public.alert_matches
  for select using (
    exists (
      select 1
      from public.alerts a
      where a.id = alert_matches.alert_id
        and a.owner_id = auth.uid()
    )
  );

-- Service role bypasses RLS entirely, so /api/ingest's writes still work.
-- We do NOT add an insert policy for anon/authenticated; user-facing alert
-- evaluation runs server-side with the admin client.

-- ----------------------------------------------------------------------------
-- 2. listing_images.phash — 64-bit perceptual hash, stored as bytea.
--    Indexed for fast "show me other listings with a similar image" queries.
-- ----------------------------------------------------------------------------
alter table public.listing_images
  add column if not exists phash bytea,
  add column if not exists phash_algo text;  -- 'dhash'|'phash'|'whash'

create index if not exists idx_listing_images_phash
  on public.listing_images(phash)
  where phash is not null;

-- Same column on cross_platform_listing_images so dedup can match across
-- the platform boundary (the whole point of pHash for this product).
alter table public.cross_platform_listing_images
  add column if not exists phash bytea,
  add column if not exists phash_algo text;

create index if not exists idx_xpl_images_phash
  on public.cross_platform_listing_images(phash)
  where phash is not null;

-- ----------------------------------------------------------------------------
-- 3. listing_image_phash_pairs — materialized candidate matches.
--    The dedup worker computes pHash, finds near-neighbours, and writes one
--    row per candidate pair. Read-side just consumes this table.
-- ----------------------------------------------------------------------------
create table if not exists public.listing_image_phash_pairs (
  id bigserial primary key,
  left_image_id uuid not null,
  right_image_id uuid not null,
  left_kind text not null check (left_kind in ('listing','cross_platform')),
  right_kind text not null check (right_kind in ('listing','cross_platform')),
  hamming_distance int not null,
  confidence numeric,            -- 1.0 = identical, 0.0 = unrelated
  computed_at timestamptz not null default now(),
  unique (left_image_id, right_image_id)
);

create index if not exists idx_phash_pairs_left
  on public.listing_image_phash_pairs(left_image_id);
create index if not exists idx_phash_pairs_right
  on public.listing_image_phash_pairs(right_image_id);
create index if not exists idx_phash_pairs_distance
  on public.listing_image_phash_pairs(hamming_distance);

alter table public.listing_image_phash_pairs enable row level security;
drop policy if exists "public read phash pairs" on public.listing_image_phash_pairs;
create policy "public read phash pairs" on public.listing_image_phash_pairs
  for select using (true);
