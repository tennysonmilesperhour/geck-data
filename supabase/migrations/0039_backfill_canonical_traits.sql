-- ============================================================================
-- Geck Data 0039: backfill canonical traits from the scraper era.
--
-- Why the trend charts were frozen
-- --------------------------------
-- combo_index_daily (0035/0036/0037) builds per-combo daily medians by
-- splitting market_listings.cached_traits on commas and pairing the tokens.
-- It joins price_history for the observation dates. The Decodo-era dual
-- write (scripts/lib/canonical.py) copied listings.traits into cached_traits
-- verbatim, and MorphMarket delimits with pipes, so:
--
--   * 5,461 canonical rows never received traits at all, and
--   * the rows that did got 'A | B | C', which string_to_array(x, ',')
--     reads as ONE token, so no pair is ever produced.
--
-- Net effect: every price tick between 2026-05-12 and 2026-06-09 (roughly
-- 28,000 observations over four weeks of real market activity) is invisible
-- to /indices, the /market sparklines and the /reports movers. The
-- materialized view was not stale because the nightly refresh was broken;
-- it was starved because nothing in that window had a parseable trait set.
--
-- What this migration does
-- ------------------------
-- 1. Adds _normalize_trait_csv(text): splits on BOTH pipe and comma, drops
--    the non-trait property segments the scrapers leak ('Diet: Meal
--    Replacement', 'Proven breeder: No', ...) exactly like 0018 did for the
--    extension stream, de-duplicates case-insensitively, and re-joins with
--    ', ' so the 0037 comma tokenizer can read it.
-- 2. Backfills cached_traits + norm_traits on canonical rows that have none,
--    reading from the scraper-side listings.traits we already store.
-- 3. Normalizes the handful of canonical rows whose cached_traits is still
--    pipe-delimited, so they stop being a single opaque token.
--
-- Idempotent: step 2 only touches rows that are still empty, step 3 only
-- touches rows that still contain a pipe. Re-running is a no-op. Nothing is
-- deleted; listings.traits and listings_history remain the source of truth.
--
-- After applying, refresh the view so the recovered history shows up:
--   select public.refresh_combo_index_daily();
-- ============================================================================

create or replace function public._normalize_trait_csv(raw text)
returns text
language sql
immutable
as $$
  select nullif(string_agg(tok, ', ' order by ord), '')
  from (
    select distinct on (lower(trim(both ' ' from t.tok)))
           trim(both ' ' from t.tok) as tok,
           t.ord
    from regexp_split_to_table(coalesce(raw, ''), '\s*[|,]\s*')
         with ordinality as t(tok, ord)
    where trim(both ' ' from t.tok) <> ''
      and trim(both ' ' from t.tok) !~*
          '^(diet|proven breeder|sex|maturity|weight|birth date|birthdate|hatched|origin|pet only|lineage|shipping|payment|scientific name|category)\s*(:|$)'
    order by lower(trim(both ' ' from t.tok)), t.ord
  ) k;
$$;

comment on function public._normalize_trait_csv(text) is
  'Normalize a raw scraper/extension trait string to comma-delimited morph tokens: splits on pipe or comma, strips non-trait property segments, de-dupes case-insensitively. Returns null when nothing survives.';

-- 1. Backfill canonical rows that never received traits from the scraper era.
update public.market_listings ml
set cached_traits = public._normalize_trait_csv(l.traits),
    norm_traits   = lower(replace(public._normalize_trait_csv(l.traits), ', ', ' '))
from public.listings l
where ml.id = 'mm_' || l.listing_id
  and (ml.cached_traits is null or ml.cached_traits = '')
  and l.traits is not null
  and l.traits <> ''
  and public._normalize_trait_csv(l.traits) is not null;

-- 2. Re-delimit any canonical rows still carrying pipe-separated traits.
update public.market_listings
set cached_traits = public._normalize_trait_csv(cached_traits),
    norm_traits   = coalesce(
      nullif(norm_traits, ''),
      lower(replace(public._normalize_trait_csv(cached_traits), ', ', ' '))
    )
where cached_traits like '%|%'
  and public._normalize_trait_csv(cached_traits) is not null;
