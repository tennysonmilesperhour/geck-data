-- 0015 — Align crested_morph_taxonomy to geck-inspect's snake_case canonical
-- ids so wild scraper images can be seeded into geck-inspect.gecko_images
-- without any further label translation.
--
-- geck-inspect's edge function (recognize-gecko-morph) consumes ids defined
-- in supabase/functions/recognize-gecko-morph/taxonomy.ts. Those ids are
-- the contract our seeder must produce — primary_morph, genetic_traits,
-- secondary_traits, base_color, etc.
--
-- This migration adds two columns:
--   canonical_id  text   — the geck-inspect snake_case id
--   trait_kind    text   — primary_morph / genetic_trait / secondary_trait / base_color
-- plus a helper function public.canonical_trait(text) for the seeder.
--
-- Idempotent — adds columns IF NOT EXISTS and overwrites a known mapping
-- so a synonyms update only requires re-running this file.

alter table public.crested_morph_taxonomy
  add column if not exists canonical_id text,
  add column if not exists trait_kind   text;

update public.crested_morph_taxonomy set canonical_id =
  case canonical_name
    when 'Patternless'         then 'patternless'
    when 'Harlequin'           then 'harlequin'
    when 'Extreme Harlequin'   then 'extreme_harlequin'
    when 'Pinstripe'           then 'pinstripe'
    when 'Full Pinstripe'      then 'full_pinstripe'
    when 'Partial Pinstripe'   then 'partial_pinstripe'
    when 'Reverse Pinstripe'   then 'reverse_pinstripe'
    when 'Quad-stripe'         then 'quad_stripe'
    when 'Tiger'               then 'tiger'
    when 'Brindle'             then 'brindle'
    when 'Dalmatian'           then 'dalmatian'
    when 'Super Dalmatian'     then 'super_dalmatian'
    when 'Tri-color'           then 'tricolor'
    when 'Lilly White'         then 'lily_white'
    when 'Lily White'          then 'lily_white'
    when 'Axanthic'            then 'axanthic_vca'
    when 'Het Axanthic'        then 'axanthic_vca'
    when 'Cappuccino'          then 'cappuccino'
    when 'Frappuccino'         then 'frappuccino'
    when 'Moonglow'            then 'moonglow'
    when 'Soft Scale'          then 'soft_scale'
    when 'Empty Back'          then 'empty_back'
    when 'White Wall'          then 'white_wall'
    when 'Whitewall'           then 'white_wall'
    when 'Hypo'                then 'hypo'
    when 'Drippy'              then 'drippy_dorsal'
    when 'Phantom'             then 'phantom'
    when 'Portholes'           then 'portholes'
    when 'Red'                 then 'red'
    when 'Red Base'            then 'red'
    when 'Red Harlequin'       then 'red'
    when 'Dark'                then 'dark_brown'
    when 'Dark Base'           then 'dark_brown'
    when 'Yellow'              then 'yellow'
    when 'Yellow Base'         then 'yellow'
    when 'Orange'              then 'orange'
    when 'Cream'               then 'cream'
    when 'Tangerine'           then 'orange'
    when 'Olive'               then 'olive'
    when 'Lavender'            then 'lavender'
    when 'Buckskin'            then 'buckskin'
    when 'Sable'               then 'dark_brown'
    else null
  end;

update public.crested_morph_taxonomy set trait_kind =
  case
    when canonical_id in (
      'patternless','flame','chevron_flame','harlequin','extreme_harlequin',
      'super_harlequin','pinstripe','full_pinstripe','partial_pinstripe',
      'phantom_pinstripe','reverse_pinstripe','quad_stripe','super_stripe',
      'tiger','super_tiger','brindle','extreme_brindle','dalmatian',
      'super_dalmatian','red_dalmatian','ink_spot','bicolor','tricolor'
    ) then 'primary_morph'
    when canonical_id in (
      'lily_white','axanthic_vca','axanthic_tsm','cappuccino','frappuccino',
      'moonglow','soft_scale','whiteout','empty_back','white_wall',
      'hypo','melanistic'
    ) then 'genetic_trait'
    when canonical_id in (
      'red','dark_red','crimson','orange','burnt_orange','yellow',
      'bright_yellow','buttery','cream','pink','coral','olive','dark_olive',
      'green','tan','buckskin','brown','dark_brown','chocolate','mahogany',
      'lavender','charcoal','near_black'
    ) then 'base_color'
    when canonical_id is not null then 'secondary_trait'
    else null
  end;

create index if not exists idx_crested_morph_taxonomy_canonical_id
  on public.crested_morph_taxonomy(canonical_id) where canonical_id is not null;
create index if not exists idx_crested_morph_taxonomy_trait_kind
  on public.crested_morph_taxonomy(trait_kind) where trait_kind is not null;

create or replace function public.canonical_trait(p_trait text)
returns table (canonical_id text, trait_kind text)
language sql stable parallel safe set search_path = public as $$
  with norm as (
    select lower(trim(p_trait)) as n
  )
  select m.canonical_id, m.trait_kind
  from public.crested_morph_taxonomy m, norm
  where m.canonical_id is not null
    and (
      m.norm_name = norm.n
      or norm.n = any (array(select lower(s) from unnest(m.synonyms) s))
    )
  limit 1;
$$;
