-- ============================================================================
-- Geck Data — training dataset views for the morph-ID model
--
-- Produces flat (image_url, traits[]) pairs suitable for PyTorch / HF /
-- whatever you point at it. Two image sources are unioned:
--
--   A) `listing_images` — photos uploaded through /upload and stored in the
--      `listing-images` Supabase Storage bucket. URLs are public.
--   B) `market_listings.raw` — extension-captured MorphMarket listings with
--      embedded image URLs pointing at MorphMarket's own CDN. Much larger
--      source; grows with every page browsed.
--
-- Trait extraction is deliberately forgiving. MorphMarket listings don't use
-- a single canonical shape — sometimes traits live at raw->'traits', other
-- times raw->'trait_list' or raw->'genetics'->'traits'. We COALESCE across
-- the likely locations and let the downstream trainer deduplicate.
--
-- Label noise is expected (seller-reported, often aspirational). Training
-- pipeline is responsible for cleaning; this view just surfaces the raw
-- joins so experiments can iterate quickly.
--
-- Idempotent — safe to re-run. Run AFTER 0002_extension_ingest.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. normalize_trait_name(text) — lowercase, trim, collapse whitespace
--    Minimal normalization only; avoids taking a position on synonyms.
-- ----------------------------------------------------------------------------
create or replace function public.normalize_trait_name(raw text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(lower(btrim(coalesce(raw, ''))), '\s+', ' ', 'g'),
    ''
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. extract_listing_traits(raw jsonb) — returns text[] of trait names
--    Looks in the plausible locations, flattens, normalizes, dedupes.
-- ----------------------------------------------------------------------------
create or replace function public.extract_listing_traits(raw jsonb)
returns text[]
language sql
immutable
as $$
  with candidates as (
    -- shape: raw->'traits' is an array of {name: "..."} objects
    select public.normalize_trait_name(elem->>'name') as t
      from jsonb_array_elements(coalesce(raw->'traits', '[]'::jsonb)) as elem
      where jsonb_typeof(raw->'traits') = 'array'
    union all
    -- shape: raw->'trait_list' is an array of strings
    select public.normalize_trait_name(elem #>> '{}') as t
      from jsonb_array_elements(coalesce(raw->'trait_list', '[]'::jsonb)) as elem
      where jsonb_typeof(raw->'trait_list') = 'array'
    union all
    -- shape: raw->'genetics'->'traits' is an array of {name: "..."} objects
    select public.normalize_trait_name(elem->>'name') as t
      from jsonb_array_elements(coalesce(raw#>'{genetics,traits}', '[]'::jsonb)) as elem
      where jsonb_typeof(raw#>'{genetics,traits}') = 'array'
    union all
    -- shape: raw->'morphs' is an array of strings or {name: "..."}
    select public.normalize_trait_name(coalesce(elem->>'name', elem #>> '{}')) as t
      from jsonb_array_elements(coalesce(raw->'morphs', '[]'::jsonb)) as elem
      where jsonb_typeof(raw->'morphs') = 'array'
  )
  select array_agg(distinct t order by t)
  from candidates
  where t is not null;
$$;

-- ----------------------------------------------------------------------------
-- 3. extract_listing_image_urls(raw jsonb) — returns text[] of absolute URLs
--    Looks in raw->'images' / 'photos' / 'media', pulls out the URL field.
-- ----------------------------------------------------------------------------
create or replace function public.extract_listing_image_urls(raw jsonb)
returns text[]
language sql
immutable
as $$
  with candidates as (
    select coalesce(elem->>'url', elem->>'src', elem->>'href', elem #>> '{}') as u
      from jsonb_array_elements(coalesce(raw->'images', '[]'::jsonb)) as elem
      where jsonb_typeof(raw->'images') = 'array'
    union all
    select coalesce(elem->>'url', elem->>'src', elem->>'href', elem #>> '{}') as u
      from jsonb_array_elements(coalesce(raw->'photos', '[]'::jsonb)) as elem
      where jsonb_typeof(raw->'photos') = 'array'
    union all
    select coalesce(elem->>'url', elem->>'src', elem->>'href', elem #>> '{}') as u
      from jsonb_array_elements(coalesce(raw->'media', '[]'::jsonb)) as elem
      where jsonb_typeof(raw->'media') = 'array'
  )
  select array_agg(distinct u)
  from candidates
  where u is not null and u like 'http%';
$$;

-- ----------------------------------------------------------------------------
-- 4. v_listing_labels — one row per listing, with traits[] and source info
-- ----------------------------------------------------------------------------
create or replace view public.v_listing_labels as
  select
    l.id                                       as listing_id,
    l.kind,
    public.extract_listing_traits(l.raw)       as traits,
    l.raw->>'species'                          as species,
    l.raw->>'sex'                              as sex,
    (l.raw->>'price')::numeric                 as price,
    nullif(l.raw->>'seller_id', '')            as seller_id,
    l.updated_at
  from public.market_listings l;

-- ----------------------------------------------------------------------------
-- 5. v_training_pairs — one row per (image_url, listing_id) pair
--    Union of uploaded images + extension-captured remote image URLs.
-- ----------------------------------------------------------------------------
create or replace view public.v_training_pairs as
  -- Uploaded images stored in the listing-images bucket.
  select
    'uploaded'::text                             as image_source,
    (
      current_setting('app.supabase_public_url', true)
      || '/storage/v1/object/public/'
      || i.storage_bucket || '/' || i.storage_path
    )                                            as image_url,
    i.listing_id,
    lab.traits,
    lab.species,
    lab.sex,
    lab.price,
    lab.seller_id,
    i.uploaded_at                                as captured_at
  from public.listing_images i
  left join public.v_listing_labels lab on lab.listing_id = i.listing_id

  union all

  -- Extension-captured remote URLs embedded in the MorphMarket JSON.
  select
    'morphmarket_cdn'::text                      as image_source,
    url                                          as image_url,
    lab.listing_id,
    lab.traits,
    lab.species,
    lab.sex,
    lab.price,
    lab.seller_id,
    lab.updated_at                               as captured_at
  from public.v_listing_labels lab
  cross join lateral unnest(
    coalesce(public.extract_listing_image_urls(
      (select raw from public.market_listings where id = lab.listing_id)
    ), '{}'::text[])
  ) as url;

-- ----------------------------------------------------------------------------
-- 6. v_trait_frequencies — sanity check: how common is each label?
-- ----------------------------------------------------------------------------
create or replace view public.v_trait_frequencies as
  select
    t                                 as trait,
    count(*)                          as listing_count
  from public.v_listing_labels,
       lateral unnest(coalesce(traits, '{}'::text[])) as t
  group by t
  order by listing_count desc;

-- ----------------------------------------------------------------------------
-- 7. RLS — views inherit from the base tables. market_listings and
--    listing_images are already public-read (set in 0001), so no new
--    policies are needed. The view itself doesn't need RLS.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 8. Usage note
--    The uploaded-images branch of v_training_pairs needs the public
--    Supabase URL to build absolute image URLs. Set it once per session
--    (or bake it into a Postgres startup config) before querying:
--
--      set app.supabase_public_url = 'https://dhotmtgryuovkmsncdby.supabase.co';
--      select image_url, traits from v_training_pairs limit 5;
--
--    If the setting isn't set, the uploaded rows will have a NULL-prefixed
--    URL — harmless, just skip them in the trainer.
-- ----------------------------------------------------------------------------
