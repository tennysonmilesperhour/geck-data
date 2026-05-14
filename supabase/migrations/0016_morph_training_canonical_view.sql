-- 0016 — v_morph_training_canonical: emit geck-inspect-canonical ids.
--
-- Where v_morph_training emits scraper-native trait names, this view
-- maps them through crested_morph_taxonomy to geck-inspect's snake_case
-- canonical ids and splits them into the field categories the
-- gecko_images table expects:
--
--   primary_morph    (single id)
--   genetic_traits   (text[] of GENETIC_TRAIT_IDS)
--   secondary_traits (text[] of SECONDARY_TRAIT_IDS)
--   base_color       (single BASE_COLOR_ID)
--
-- Rows where no primary_morph can be resolved are filtered out — those
-- aren't useful for seeding gecko_images since primary_morph is the
-- main label.

create or replace view public.v_morph_training_canonical as
with rows as (
  select v.image_url, v.listing_id, v.traits, v.sex, v.maturity,
         v.price, v.currency, v.source, v.split
  from public.v_morph_training v
  where array_length(coalesce(v.traits, '{}'::text[]), 1) > 0
),
mapped as (
  select r.*,
    (
      select array_agg(distinct c.canonical_id)
      from unnest(r.traits) t
      join public.crested_morph_taxonomy c on c.canonical_name = t
      where c.canonical_id is not null and c.trait_kind = 'primary_morph'
    ) as primary_morph_ids,
    (
      select array_agg(distinct c.canonical_id)
      from unnest(r.traits) t
      join public.crested_morph_taxonomy c on c.canonical_name = t
      where c.canonical_id is not null and c.trait_kind = 'genetic_trait'
    ) as genetic_trait_ids,
    (
      select array_agg(distinct c.canonical_id)
      from unnest(r.traits) t
      join public.crested_morph_taxonomy c on c.canonical_name = t
      where c.canonical_id is not null and c.trait_kind = 'secondary_trait'
    ) as secondary_trait_ids,
    (
      select c.canonical_id
      from unnest(r.traits) t
      join public.crested_morph_taxonomy c on c.canonical_name = t
      where c.canonical_id is not null and c.trait_kind = 'base_color'
      limit 1
    ) as base_color_id
  from rows r
)
select
  image_url,
  listing_id,
  (primary_morph_ids)[1] as primary_morph,
  coalesce(genetic_trait_ids,   '{}'::text[]) as genetic_traits,
  coalesce(secondary_trait_ids, '{}'::text[]) as secondary_traits,
  base_color_id as base_color,
  sex, maturity, price, currency, source, split,
  traits as original_traits
from mapped
where (primary_morph_ids)[1] is not null;
