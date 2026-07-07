-- ============================================================================
-- Geck Data 0028: backfill historical price drops and sanitize trait columns.
--
-- 1. price_history contains every observed price per listing, but price_drops
--    only gets new rows from the extension's `priceDrop` event. Listings
--    whose price fell before the extension shipped the event (or where the
--    extension missed a window) never produced a price_drops row, leaving
--    /price-drops analytics under-counted. Backfill from price_history
--    using a window function over (listing_id ORDER BY observed_at).
--
-- 2. cached_traits/norm_traits can still hold leaked key/value segments
--    ("Diet: Meal Replacement", "Proven breeder: No") from rows ingested
--    before sanitization moved into the projectListing path (events.ts).
--    Apply the same regex strip on existing rows so /trends + /market
--    stop surfacing fake morphs derived from those words.
--
-- Both passes are idempotent: re-running won't double-write drops (unique
-- constraint added below) and the trait sanitization is a fixed-point
-- transform: running it twice produces the same output.
--
-- AMENDED 2026-07-07, before the first prod apply. The original dedup
-- key (listing_id, observed_at, source) was insufficient: a dry run
-- showed 2,548 of 2,555 lag-derived candidates were near-duplicates of
-- drops the extension had already recorded at a slightly different
-- timestamp, so the insert would have doubled the price_drops table.
-- The insert now also skips candidates that already have a price_drops
-- row for the same listing within one hour. Applied to prod that day
-- with this guard (7 genuinely missed drops inserted, 56 trait rows
-- sanitized; originals snapshotted in _backup_0028_trait_rows).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. price_drops backfill.
-- ----------------------------------------------------------------------------

-- Add a unique partial constraint so the backfill is replayable. We tag
-- backfilled rows with source='backfill_0028' so a re-run skips them via
-- ON CONFLICT.
create unique index if not exists idx_price_drops_listing_observed_src
  on public.price_drops(listing_id, observed_at, source);

insert into public.price_drops (
  listing_id, old_price, new_price, old_price_usd, new_price_usd,
  currency, pct_change, observed_at, source
)
select
  listing_id,
  prev_price                                              as old_price,
  price                                                   as new_price,
  prev_usd                                                as old_price_usd,
  price_usd_equivalent                                    as new_price_usd,
  currency,
  case
    when prev_price is null or prev_price = 0 then null
    else ((price - prev_price) / prev_price) * 100.0
  end                                                     as pct_change,
  observed_at,
  'backfill_0028'                                         as source
from (
  select
    listing_id,
    price,
    price_usd_equivalent,
    currency,
    observed_at,
    lag(price)                  over w as prev_price,
    lag(price_usd_equivalent)   over w as prev_usd
  from public.price_history
  window w as (partition by listing_id order by observed_at)
) windowed
where prev_price is not null
  and price       is not null
  and price < prev_price
  and not exists (
    select 1 from public.price_drops pd
    where pd.listing_id = windowed.listing_id
      and pd.observed_at between windowed.observed_at - interval '1 hour'
                             and windowed.observed_at + interval '1 hour'
  )
on conflict (listing_id, observed_at, source) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Trait sanitization backfill.
--    Strip leaked key/value segments. The list mirrors KEY_PREFIXES in
--    src/lib/traits.ts. A row collapsing to empty becomes NULL.
-- ----------------------------------------------------------------------------

create or replace function public._sanitize_cached_traits(input text)
returns text
language plpgsql
immutable
as $$
declare
  segs text[];
  kept text[] := '{}';
  s text;
  re text := '^\s*(diet|proven breeder|sex|maturity|weight|birth date|birthdate|hatched|origin|pet only|lineage|shipping|payment|scientific name|category)\s*(:|$|\|)';
begin
  if input is null or btrim(input) = '' then return null; end if;
  if position('|' in input) > 0 then
    segs := string_to_array(input, '|');
  else
    segs := array[input];
  end if;
  foreach s in array segs loop
    s := btrim(s);
    if s = '' then continue; end if;
    if s ~* re then continue; end if;
    kept := array_append(kept, s);
  end loop;
  if cardinality(kept) = 0 then return null; end if;
  return array_to_string(kept, ' | ');
end;
$$;

create or replace function public._sanitize_norm_traits(input text)
returns text
language plpgsql
immutable
as $$
declare
  segs text[];
  kept text[] := '{}';
  s text;
begin
  if input is null or btrim(input) = '' then return null; end if;
  segs := string_to_array(input, ',');
  foreach s in array segs loop
    s := btrim(s);
    if s = '' or position(':' in s) > 0 then continue; end if;
    kept := array_append(kept, s);
  end loop;
  if cardinality(kept) = 0 then return null; end if;
  return array_to_string(kept, ', ');
end;
$$;

-- One pass over market_listings. Only update rows that actually change so
-- we don't churn timestamps on millions of clean rows.
update public.market_listings ml
   set cached_traits = public._sanitize_cached_traits(ml.cached_traits),
       norm_traits   = public._sanitize_norm_traits(ml.norm_traits)
 where (ml.cached_traits is distinct from public._sanitize_cached_traits(ml.cached_traits))
    or (ml.norm_traits   is distinct from public._sanitize_norm_traits(ml.norm_traits));
