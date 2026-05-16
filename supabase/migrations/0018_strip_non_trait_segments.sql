-- 0018_strip_non_trait_segments.sql
--
-- Backfill: clean `Diet: ...|`, `Proven breeder: ...|` (and friends) out of
-- market_listings.cached_traits + norm_traits.
--
-- Why this is needed
-- ------------------
-- The Chrome extension concatenates the MorphMarket additionalProperty
-- list into cached_traits and norm_traits using " | " as the separator,
-- including non-trait properties. ~2818 of ~6717 rows (~42%) have a
-- leaked `Diet: ...` or `Proven breeder: ...` prefix segment that
-- downstream tokenizers ( /trends, RidgePlot, Sunburst, BoxPlot,
-- ForceGraph, TraitFrequencyAndPrice ) interpret as a morph.
--
-- Cleanup strategy
-- ----------------
-- 1. Split cached_traits on " | ".
-- 2. Drop any segment whose head is a known non-trait property name —
--    either `<key>: <value>` or the bare `<key>` (the extension
--    sometimes emits the bare name).
-- 3. Re-join the surviving segments with " | ".
-- 4. Rebuild norm_traits from the cleaned cached_traits by lowercasing
--    and replacing "|" with a space (the same flattening the writer
--    pipeline does). This is the lossless path — trying to clean
--    norm_traits in place via comma-split drops real trait tokens that
--    happen to be trapped in the same comma-segment as a polluted key.
-- 5. Idempotent: rows whose cached_traits no longer contain any matching
--    prefix are left untouched.
--
-- This migration runs as one transaction. The companion write-side guard
-- lives in src/lib/ingest/events.ts (sanitizeCachedTraits +
-- sanitizeNormTraits) so new ingest events do not re-pollute these
-- columns.
--
-- Apply manually in the Supabase SQL Editor after merge.

begin;

with polluted as (
  select id, cached_traits as old_cached
  from public.market_listings
  where cached_traits ~* '^\s*(diet|proven breeder|sex|maturity|weight|birth date|birthdate|hatched|origin|pet only|lineage|shipping|payment|scientific name|category)\s*(:|$|\|)'
     or cached_traits ~* '\|\s*(diet|proven breeder|sex|maturity|weight|birth date|birthdate|hatched|origin|pet only|lineage|shipping|payment|scientific name|category)\s*(:|$|\|)'
     or norm_traits   ~* '(^|\s)(diet|proven breeder|sex|maturity|weight|birth date|birthdate|hatched|origin|pet only|lineage|shipping|payment|scientific name|category)\s*:'
),
cleaned as (
  select p.id,
         (
           select string_agg(seg, ' | ')
           from (
             select trim(both ' ' from x) as seg
             from regexp_split_to_table(coalesce(l.cached_traits, ''), '\s*\|\s*') as x
             where x !~* '^\s*(diet|proven breeder|sex|maturity|weight|birth date|birthdate|hatched|origin|pet only|lineage|shipping|payment|scientific name|category)\s*(:|$|\|)'
               and trim(both ' ' from x) <> ''
           ) sub
         ) as new_cached
  from polluted p
  join public.market_listings l on l.id = p.id
)
update public.market_listings ml
set cached_traits = c.new_cached,
    norm_traits   = lower(replace(coalesce(c.new_cached, ''), '|', ' '))
from cleaned c
where ml.id = c.id;

-- Sanity probe: after the update, no row should still match the
-- pollution pattern.
do $$
declare remaining int;
begin
  select count(*) into remaining
  from public.market_listings
  where cached_traits ~* '(^|\|\s*)(diet|proven breeder|sex|maturity|weight|birth date|birthdate|hatched|origin|pet only|lineage|shipping|payment|scientific name|category)\s*(:|$|\|)'
     or norm_traits   ~* '(^|\s)(diet|proven breeder|sex|maturity|weight|birth date|birthdate|hatched|origin|pet only|lineage|shipping|payment|scientific name|category)\s*:';
  if remaining > 0 then
    raise exception 'cleanup left % polluted rows; aborting', remaining;
  end if;
end$$;

commit;
