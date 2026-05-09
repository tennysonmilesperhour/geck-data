-- ============================================================================
-- Geck Data 0009: lineage, in-progress auction state, cross-platform images,
--                 external reference images, morph taxonomy.
--
-- Closes the gaps surfaced by the integration audit:
--   - lineage events (parents/dams/sires) were previously dropped on the floor
--     by legacyAdapter because there was no destination table.
--   - auction (mid-auction snapshot) events were also dropped; auction_results
--     only captures the close.
--   - cross_platform_listings had no companion image table; cross-platform
--     listings could never accumulate a gallery.
--   - No table existed to stage reference images from external open sources
--     (iNaturalist, Leopard Gecko Wiki, breeder partnerships).
--   - Morph taxonomy (canonical alleles, inheritance, synonyms) was implicit
--     in client code only; importer pipelines need a destination.
--
-- Safe to re-run; uses IF NOT EXISTS / ON CONFLICT.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. New columns on market_listings
-- ----------------------------------------------------------------------------
-- first_listed_at: when the seller actually published the listing (from the
-- MorphMarket `first_listed` field on the animal payload). Distinct from
-- first_seen_at, which is when our extension first observed it.
alter table public.market_listings
  add column if not exists first_listed_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. listing_lineage
--    Parents recorded against a listing. role = 'dam' | 'sire' | 'parent'
--    (parent for entries where the breeder did not specify which side).
--    Parent rows do not need to have their own market_listings entry; we
--    capture the breeder-supplied label even if the parent is off-market.
-- ----------------------------------------------------------------------------
create table if not exists public.listing_lineage (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.market_listings(id) on delete cascade,
  role text not null check (role in ('dam', 'sire', 'parent')),
  parent_id text,
  parent_label text,
  parent_traits jsonb,
  parent_url text,
  observed_at timestamptz not null default now(),
  unique (listing_id, role, parent_id, parent_label)
);

create index if not exists idx_listing_lineage_listing_id
  on public.listing_lineage(listing_id);
create index if not exists idx_listing_lineage_parent_id
  on public.listing_lineage(parent_id) where parent_id is not null;

alter table public.listing_lineage enable row level security;
drop policy if exists "public read listing_lineage" on public.listing_lineage;
create policy "public read listing_lineage" on public.listing_lineage
  for select using (true);

-- ----------------------------------------------------------------------------
-- 3. auction_state
--    Snapshots of an auction while it is still running. auction_results
--    captures the final close; this captures price/bid_count progress.
-- ----------------------------------------------------------------------------
create table if not exists public.auction_state (
  id bigserial primary key,
  listing_id text not null references public.market_listings(id) on delete cascade,
  current_price numeric,
  current_price_usd numeric,
  currency text,
  bid_count integer,
  ends_at timestamptz,
  observed_at timestamptz not null default now(),
  source text default 'extension'
);

create index if not exists idx_auction_state_listing_observed
  on public.auction_state(listing_id, observed_at desc);

alter table public.auction_state enable row level security;
drop policy if exists "public read auction_state" on public.auction_state;
create policy "public read auction_state" on public.auction_state
  for select using (true);

-- ----------------------------------------------------------------------------
-- 4. cross_platform_listing_images
--    Mirrors listing_images but FKs into cross_platform_listings, which has
--    a different primary key (uuid, not the morphmarket text id).
-- ----------------------------------------------------------------------------
create table if not exists public.cross_platform_listing_images (
  id uuid primary key default gen_random_uuid(),
  cross_platform_listing_id uuid not null
    references public.cross_platform_listings(id) on delete cascade,
  storage_bucket text not null default 'listing-images',
  storage_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  image_url text not null,
  caption text,
  uploaded_at timestamptz not null default now(),
  unique (cross_platform_listing_id, image_url)
);

create index if not exists idx_xpl_images_listing
  on public.cross_platform_listing_images(cross_platform_listing_id);

alter table public.cross_platform_listing_images enable row level security;
drop policy if exists "public read cross_platform_listing_images"
  on public.cross_platform_listing_images;
create policy "public read cross_platform_listing_images"
  on public.cross_platform_listing_images
  for select using (true);

-- ----------------------------------------------------------------------------
-- 5. external_reference_images
--    Above-board open-source reference data. iNaturalist (CC-licensed wild
--    type), Leopard Gecko Wiki (CC-BY-SA), breeder partnerships, etc.
--    source_kind/source_id together identify the upstream record so re-imports
--    are idempotent.
-- ----------------------------------------------------------------------------
create table if not exists public.external_reference_images (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in (
    'inaturalist', 'leopard_gecko_wiki', 'reptidex', 'breeder_partner', 'other'
  )),
  source_id text not null,
  source_url text,
  species text,
  morph_label text,
  norm_morph_label text,
  license text,
  attribution text,
  storage_bucket text default 'listing-images',
  storage_path text,
  image_url text,
  width integer,
  height integer,
  captured_at timestamptz,
  imported_at timestamptz not null default now(),
  raw jsonb,
  unique (source_kind, source_id)
);

create index if not exists idx_ext_ref_morph
  on public.external_reference_images(norm_morph_label);
create index if not exists idx_ext_ref_species
  on public.external_reference_images(species);

alter table public.external_reference_images enable row level security;
drop policy if exists "public read external_reference_images"
  on public.external_reference_images;
create policy "public read external_reference_images"
  on public.external_reference_images
  for select using (true);

-- ----------------------------------------------------------------------------
-- 6. morph_taxonomy
--    Canonical morph/allele records imported from ReptiDex / Leopard Gecko
--    Wiki / breeder dictionaries. Used by geck-inspect's morph guide and
--    by the recognition pipeline to normalize free-text trait strings.
-- ----------------------------------------------------------------------------
create table if not exists public.morph_taxonomy (
  id uuid primary key default gen_random_uuid(),
  species text not null,
  canonical_name text not null,
  norm_name text not null,
  inheritance text,
  allele_group text,
  parent_morphs text[],
  synonyms text[],
  description text,
  source_kind text not null,
  source_id text,
  source_url text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (species, norm_name, source_kind)
);

create index if not exists idx_morph_taxonomy_species_norm
  on public.morph_taxonomy(species, norm_name);

alter table public.morph_taxonomy enable row level security;
drop policy if exists "public read morph_taxonomy" on public.morph_taxonomy;
create policy "public read morph_taxonomy" on public.morph_taxonomy
  for select using (true);
