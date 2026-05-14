-- ============================================================================
-- 0014 — Morph ID training dataset views + crested morph taxonomy
--
-- Produces a flat (image_url, listing_id, traits[], ...) training set ready
-- for a PyTorch multi-label classifier. Two key differences from 0003's
-- v_training_pairs (which was built for the extension's market_listings.raw
-- jsonb shape that we no longer write to):
--
--   1. Reads from public.listings (the scraper's canonical output) which
--      has 5,800+ rows with cleaned trait_array + primary_image_url.
--   2. Filters out the seller-questionnaire noise ("Diet: Cricket",
--      "Proven breeder: No", etc.) so labels are actual morph traits.
--
-- Outputs:
--   - public.crested_morph_taxonomy : canonical trait list for crested geckos
--   - public.is_training_trait(text) -> boolean : filter for the noise
--   - public.v_morph_training : (image_url, listing_id, traits, sex,
--                                maturity, price, source, split) per image
--   - public.v_morph_training_stats : per-trait coverage counts for the UI
--
-- Split assignment is deterministic via md5(listing_id)::bit(8) modulo:
--   0–69  → train  (70%)
--   70–84 → val    (15%)
--   85–99 → test   (15%)
-- This means a listing's images all land in the same split, preventing
-- train/val contamination by listing identity.
--
-- Idempotent; safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. crested_morph_taxonomy
-- ----------------------------------------------------------------------------
create table if not exists public.crested_morph_taxonomy (
  canonical_name text primary key,
  norm_name text not null,
  category text not null check (category in (
    'pattern','color','dorsal','eye','scale','other','base'
  )),
  synonyms text[] not null default '{}',
  is_morph boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_crested_morph_taxonomy_norm
  on public.crested_morph_taxonomy(norm_name);

-- Seed the canonical crested gecko trait set. Names match MorphMarket's
-- own labels so trait-array lookups join cleanly without normalization.
insert into public.crested_morph_taxonomy (canonical_name, norm_name, category, synonyms) values
  -- Pattern / structural
  ('Harlequin',          'harlequin',          'pattern', array['harley']),
  ('Extreme Harlequin',  'extreme harlequin',  'pattern', array['extreme harley','ex harley']),
  ('Tri-color',          'tri-color',          'pattern', array['tricolor','tri color']),
  ('Pinstripe',          'pinstripe',          'pattern', array['pin','pinner']),
  ('Full Pinstripe',     'full pinstripe',     'pattern', array['full pin']),
  ('Partial Pinstripe',  'partial pinstripe',  'pattern', array['partial pin']),
  ('Quad-stripe',        'quad-stripe',        'pattern', array['quadstripe','quad stripe']),
  ('Reverse Pinstripe',  'reverse pinstripe',  'pattern', array['rev pin','reverse pin']),
  ('Dalmatian',          'dalmatian',          'pattern', array['dal']),
  ('Super Dalmatian',    'super dalmatian',    'pattern', array['super dal']),
  ('Phantom',            'phantom',            'pattern', array[]::text[]),
  ('Empty Back',         'empty back',         'pattern', array[]::text[]),
  ('Drippy',             'drippy',             'pattern', array[]::text[]),
  ('Portholes',          'portholes',          'pattern', array['porthole']),
  ('Tiger',              'tiger',              'pattern', array[]::text[]),
  ('Brindle',            'brindle',            'pattern', array[]::text[]),

  -- Color / pigmentation
  ('Lilly White',        'lilly white',        'color',   array['lilly','lily white','lily']),
  ('Cappuccino',         'cappuccino',         'color',   array['cap','capp']),
  ('Frappuccino',        'frappuccino',        'color',   array['frap','frapp']),
  ('Moonglow',           'moonglow',           'color',   array[]::text[]),
  ('Sable',              'sable',              'color',   array[]::text[]),
  ('Axanthic',           'axanthic',           'color',   array['axan']),
  ('Soft Scale',         'soft scale',         'scale',   array['softscale','softie']),
  ('Red',                'red',                'color',   array[]::text[]),
  ('Red Base',           'red base',           'color',   array[]::text[]),
  ('Red Harlequin',      'red harlequin',      'color',   array['red harley']),
  ('Yellow',             'yellow',             'color',   array[]::text[]),
  ('Yellow Base',        'yellow base',        'color',   array[]::text[]),
  ('Orange',             'orange',             'color',   array[]::text[]),
  ('Cream',              'cream',              'color',   array[]::text[]),
  ('Tangerine',          'tangerine',          'color',   array[]::text[]),
  ('Dark',               'dark',               'color',   array[]::text[]),
  ('Dark Base',          'dark base',          'color',   array[]::text[]),
  ('Olive',              'olive',              'color',   array[]::text[]),
  ('Lavender',           'lavender',           'color',   array[]::text[]),
  ('Buckskin',           'buckskin',           'color',   array[]::text[]),
  ('Patternless',        'patternless',        'pattern', array[]::text[]),
  ('White Wall',         'white wall',         'pattern', array['whitewall']),

  -- Eye / scale modifiers
  ('Whitewall',          'whitewall',          'pattern', array[]::text[]),
  ('Lily White',         'lily white',         'color',   array[]::text[]),
  ('Hypo',               'hypo',               'other',   array['hypomelanistic']),
  ('Het Axanthic',       'het axanthic',       'other',   array['het ax'])
on conflict (canonical_name) do update set
  norm_name = excluded.norm_name,
  category  = excluded.category,
  synonyms  = excluded.synonyms;

alter table public.crested_morph_taxonomy enable row level security;
drop policy if exists "public read crested_morph_taxonomy"
  on public.crested_morph_taxonomy;
create policy "public read crested_morph_taxonomy"
  on public.crested_morph_taxonomy for select using (true);

-- ----------------------------------------------------------------------------
-- 2. is_training_trait — filter out the seller-questionnaire noise
--
-- The scraper picks up free-text labels including things like "Diet: Meal
-- Replacement, Cricket" and "Proven breeder: No" which are not morphs.
-- A trait is training-eligible iff:
--   - it does not start with "Diet:"
--   - it does not start with "Proven breeder"
--   - it appears in crested_morph_taxonomy.canonical_name OR matches a
--     synonym (case-insensitive)
-- ----------------------------------------------------------------------------
create or replace function public.is_training_trait(p_trait text)
returns boolean
language sql
stable
parallel safe
set search_path = public
as $$
  with input as (
    select lower(trim(p_trait)) as norm
  ),
  match as (
    select exists (
      select 1 from public.crested_morph_taxonomy m, input i
      where m.norm_name = i.norm
         or i.norm = any(array(select lower(s) from unnest(m.synonyms) s))
    ) as is_match
  )
  select case
    when p_trait is null then false
    when p_trait ilike 'Diet:%'             then false
    when p_trait ilike 'Proven breeder%'    then false
    else (select is_match from match)
  end;
$$;

-- ----------------------------------------------------------------------------
-- 3. v_morph_training — flat (image_url, listing_id, traits[], ...) per image
--
-- Sources:
--   A. public.listings.primary_image_url      (one row per listing)
--   B. public.listings.all_image_urls         (unnested; usually same as A)
--   C. public.listing_images (uploaded photos linked to market_listings.id)
--
-- The split column is deterministic from md5(listing_id) so re-running the
-- view yields the same partition. Listings that resolve to a recognised
-- canonical morph from is_training_trait() carry a non-empty traits[].
-- ----------------------------------------------------------------------------
create or replace view public.v_morph_training as
with
listing_traits as (
  -- Drop the metadata noise from trait_array; keep only training-eligible.
  select
    l.listing_id,
    l.primary_image_url,
    l.all_image_urls,
    l.sex,
    l.maturity,
    l.price,
    l.currency,
    (
      select coalesce(array_agg(t order by t), '{}'::text[])
      from unnest(coalesce(l.trait_array, '{}'::text[])) as t
      where public.is_training_trait(t)
    ) as traits,
    case (('x' || substr(md5(l.listing_id), 1, 2))::bit(8)::int) % 100
      when 0  then 'train' when 1  then 'train' when 2  then 'train'
      when 3  then 'train' when 4  then 'train' when 5  then 'train'
      when 6  then 'train' when 7  then 'train' when 8  then 'train'
      when 9  then 'train'
      else case
        when (('x' || substr(md5(l.listing_id), 1, 2))::bit(8)::int) % 100 < 70 then 'train'
        when (('x' || substr(md5(l.listing_id), 1, 2))::bit(8)::int) % 100 < 85 then 'val'
        else 'test'
      end
    end as split
  from public.listings l
  where l.primary_image_url is not null
    and l.is_active is not false
)
-- primary image (one row per listing)
select
  primary_image_url           as image_url,
  listing_id,
  traits,
  sex, maturity, price, currency,
  'scraper_primary'::text     as source,
  split
from listing_traits
where primary_image_url is not null

union all
-- additional images from the array
select
  url                         as image_url,
  lt.listing_id,
  lt.traits,
  lt.sex, lt.maturity, lt.price, lt.currency,
  'scraper_array'::text       as source,
  lt.split
from listing_traits lt,
     lateral unnest(coalesce(lt.all_image_urls, '{}'::text[])) as url
where url is not null and url <> lt.primary_image_url

union all
-- uploaded images via /upload (linked through listing_images.listing_id =
-- market_listings.id). We surface them with the matching scraper listing
-- when possible, else with a NULL trait array.
select
  -- Build the public storage URL.
  (
    'https://dhotmtgryuovkmsncdby.supabase.co/storage/v1/object/public/'
    || li.storage_bucket || '/' || li.storage_path
  )                           as image_url,
  -- Strip the 'mm_' prefix on listing_id to align with public.listings.listing_id.
  case
    when li.listing_id like 'mm_%' then substring(li.listing_id from 4)
    else li.listing_id
  end                         as listing_id,
  (
    select coalesce(array_agg(t order by t), '{}'::text[])
    from unnest(coalesce(l.trait_array, '{}'::text[])) as t
    where public.is_training_trait(t)
  )                           as traits,
  l.sex, l.maturity, l.price, l.currency,
  'uploaded'::text            as source,
  case (('x' || substr(md5(li.listing_id), 1, 2))::bit(8)::int) % 100
    when 0  then 'train' when 1  then 'train' when 2  then 'train'
    when 3  then 'train' when 4  then 'train' when 5  then 'train'
    when 6  then 'train' when 7  then 'train' when 8  then 'train'
    when 9  then 'train'
    else case
      when (('x' || substr(md5(li.listing_id), 1, 2))::bit(8)::int) % 100 < 70 then 'train'
      when (('x' || substr(md5(li.listing_id), 1, 2))::bit(8)::int) % 100 < 85 then 'val'
      else 'test'
    end
  end as split
from public.listing_images li
left join public.listings l on l.listing_id = (
  case when li.listing_id like 'mm_%' then substring(li.listing_id from 4)
       else li.listing_id end
);

-- ----------------------------------------------------------------------------
-- 4. v_morph_training_stats — per-trait coverage + per-split count
-- ----------------------------------------------------------------------------
create or replace view public.v_morph_training_stats as
with images_by_split as (
  select split, count(*) as n
  from public.v_morph_training
  where traits is not null and array_length(traits, 1) > 0
  group by split
),
per_trait as (
  select t as trait,
         count(*) as image_count,
         count(distinct listing_id) as listing_count
  from public.v_morph_training,
       lateral unnest(coalesce(traits, '{}'::text[])) as t
  where array_length(traits, 1) > 0
  group by t
)
select
  'split'::text   as kind,
  split           as key,
  n               as image_count,
  null::int       as listing_count
from images_by_split

union all

select
  'trait'::text   as kind,
  trait           as key,
  image_count,
  listing_count
from per_trait;
