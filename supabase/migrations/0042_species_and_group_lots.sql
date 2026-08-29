-- ============================================================================
-- Geck Data 0042: stamp species, and flag multi-animal listings.
--
-- Two data-quality gaps the shared audit called out, both of which make the
-- public numbers describe something other than what they claim.
--
-- 1. species was 'unknown' on 100% of 10,239 canonical rows even though the
--    ingest only accepts crested geckos and 6,715 rows carry
--    scientific_name 'Correlophus ciliatus'. The UI says crested-only while
--    the column says it does not know. Read paths accept ('crested','unknown')
--    so stamping the ones we can prove changes no page's row set; it just
--    stops the column from lying.
--
-- 2. Group lots, packs, pairs, trios and auctions sit in the same medians as
--    single animals. Their price is for the GROUP: production has "Group Of 5"
--    at $100 total and "Wholesale 5/10 Lot Cresties" at $50, which the landing
--    page then advertised as a 90% discount against a single-animal combo
--    median. A per-animal comp cannot include them.
--
--    This adds a flag rather than deleting or hiding anything. Lot listings
--    stay browsable; comp/median/opportunity paths filter them out. The
--    detector is deliberately eager on the title (a false positive costs one
--    listing's worth of comp breadth, a false negative distorts a median) but
--    it never infers from price alone.
-- ============================================================================

alter table public.market_listings
  add column if not exists is_group_lot boolean not null default false;

create index if not exists idx_market_listings_group_lot
  on public.market_listings(is_group_lot) where is_group_lot;

create or replace function public._looks_like_group_lot(title text, is_auction boolean default false)
returns boolean
language sql
immutable
as $$
  select coalesce(
    title ~* '\m(lot|lots|pack|packs|wholesale|bundle|colony|pair|pairs|trio|trios|quad|group)\M'
    or title ~* '\m(x\s*[2-9]|[2-9]\s*x)\M'
    or title ~* '\m(two|three|four|five|six)\s+(pack|lot|group|of)\M'
    or title ~* '\mgroup\s+of\s+[0-9]+\M',
  false);
$$;

comment on function public._looks_like_group_lot(text, boolean) is
  'Heuristic: does this listing title describe more than one animal (lot/pack/pair/trio/group/xN)? Used to keep group pricing out of single-animal comps. Eager by design.';

-- 1. Stamp species where the source proves it.
update public.market_listings ml
set species = 'crested'
from public.listings l
where ml.id = 'mm_' || l.listing_id
  and ml.species is distinct from 'crested'
  and (l.scientific_name ilike '%correlophus%' or l.category ilike '%crested%');

-- 2. Flag multi-animal listings.
update public.market_listings
set is_group_lot = true
where is_group_lot = false
  and public._looks_like_group_lot(title);

comment on column public.market_listings.is_group_lot is
  'True when the title describes multiple animals (lot, pack, pair, trio, group, xN). Such listings price a group, so they must be excluded from per-animal medians, comps and discount calculations.';
