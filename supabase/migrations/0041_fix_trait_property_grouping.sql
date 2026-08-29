-- ============================================================================
-- Geck Data 0041: fix 0039's trait parse. Pipes group, commas list.
--
-- What 0039 got wrong
-- -------------------
-- _normalize_trait_csv() split on pipe and comma at the same time. That
-- destroys the structure the scrapers actually emit:
--
--   Diet: Cricket, Meal Replacement | Proven breeder: No | Harlequin, Partial Pinstripe
--   ^-- property, values comma-listed   ^-- property      ^-- the real traits
--
-- Pipes separate PROPERTIES; commas list values INSIDE one property.
-- Flattening both at once dropped the 'Diet:' head token but kept its
-- values, so 'Cricket', 'Meal Replacement', 'Roach' and 'BSFL' survived as
-- if they were morphs. After 0039 the largest combos on /indices were
-- 'Harlequin x Meal Replacement' (n=159) and 'Meal Replacement x Roach'.
-- That is the same pseudo-trait contamination 0018 cleaned out of the
-- extension stream, reintroduced through the scraper column.
--
-- The fix
-- -------
-- Parse pipe-first: split into property segments, drop any segment whose
-- head is a non-trait key (dropping ALL of that property's values with it),
-- then comma-split only the segments that survive. Rows whose entire trait
-- string was diet/breeder metadata correctly end up with no traits at all.
--
-- Then recompute every canonical row whose scraper source carries such a
-- property segment, which is exactly the set 0039 corrupted. Rows with no
-- surviving morph token are reset to null: "we have no trait data for this
-- listing" is the honest state, and an empty combo is better than a fake one.
--
-- Refresh the view afterwards:
--   select public.refresh_combo_index_daily();
-- ============================================================================

create or replace function public._normalize_trait_csv(raw text)
returns text
language sql
immutable
as $$
  select nullif(string_agg(tok, ', ' order by ord), '')
  from (
    select distinct on (lower(trim(both ' ' from parts.tok)))
           trim(both ' ' from parts.tok) as tok,
           parts.ord
    from (
      -- Property segments first; a dropped segment takes its values with it.
      select s.tok, (t.ord * 1000 + s.ord) as ord
      from regexp_split_to_table(coalesce(raw, ''), '\s*\|\s*')
           with ordinality as t(seg, ord)
      cross join lateral regexp_split_to_table(t.seg, '\s*,\s*')
           with ordinality as s(tok, ord)
      where trim(both ' ' from t.seg) !~*
            '^(diet|proven breeder|sex|maturity|weight|birth date|birthdate|hatched|origin|pet only|lineage|shipping|payment|scientific name|category)\s*(:|$)'
    ) parts
    where trim(both ' ' from parts.tok) <> ''
    order by lower(trim(both ' ' from parts.tok)), parts.ord
  ) k;
$$;

comment on function public._normalize_trait_csv(text) is
  'Normalize a raw scraper/extension trait string to comma-delimited morph tokens. Pipes separate properties, commas list values within a property: a non-trait property (Diet, Proven breeder, ...) is dropped whole, values included. De-dupes case-insensitively. Returns null when nothing survives.';

-- Recompute the rows 0039 corrupted: any canonical row whose scraper source
-- carries a non-trait property segment. Idempotent, and a no-op once the
-- values already match.
update public.market_listings ml
set cached_traits = public._normalize_trait_csv(l.traits),
    norm_traits   = lower(replace(public._normalize_trait_csv(l.traits), ', ', ' '))
from public.listings l
where ml.id = 'mm_' || l.listing_id
  and l.traits ~* '(^|\|)\s*(diet|proven breeder|sex|maturity|weight|birth date|birthdate|hatched|origin|pet only|lineage|shipping|payment|scientific name|category)\s*(:|$)'
  and ml.cached_traits is distinct from public._normalize_trait_csv(l.traits);
