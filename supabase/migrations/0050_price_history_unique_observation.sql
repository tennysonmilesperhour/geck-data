-- ============================================================================
-- Geck Data 0050: one observation per listing per instant, enforced.
--
-- price_history is the spine of every timeline on the site, and nothing has
-- ever stopped it holding the same observation twice. Two writers insert into
-- it (the /api/ingest event handlers and the Python backfill), both with a
-- plain INSERT, so a replayed batch or a listingSeen and a priceDropped event
-- carrying the same occurred_at each land a second row. 104 such rows exist
-- today out of 45,632.
--
-- Duplicated observations do not just inflate a row count. Everything that
-- counts observations per day to decide whether a day has coverage, and
-- everything that averages price per listing per bucket, reads a doubled row
-- as two independent confirmations. The reports gate and the combo index both
-- do exactly that.
--
-- Checked before writing this: all 104 duplicate groups are pairs, and zero of
-- them differ in price, price_usd_equivalent, currency, source or usd_rate_used.
-- They are the same observation recorded twice, so collapsing them loses no
-- history. The losing rows are copied to price_history_dupes_archive first
-- anyway, because a delete against a production table should be reversible
-- even when the analysis says it is safe.
-- ============================================================================

-- 1. Keep a copy of every row this migration removes. Retains the original id
--    so a row can be put back exactly as it was.
create table if not exists public.price_history_dupes_archive (
  like public.price_history including defaults,
  archived_at timestamptz not null default timezone('UTC', now()),
  archived_by text not null default 'migration_0050'
);

comment on table public.price_history_dupes_archive is
  'Rows removed from price_history when the (listing_id, observed_at) unique key was introduced. Every archived row had a surviving twin identical in every column but id.';

alter table public.price_history_dupes_archive enable row level security;

-- 2. Copy, then delete, the extra row in each duplicate group. ctid ordering
--    is arbitrary but stable within the statement, and since the rows are
--    identical in every meaningful column it does not matter which survives.
with ranked as (
  select ctid,
         row_number() over (partition by listing_id, observed_at order by ctid) as rn
  from public.price_history
),
doomed as (
  select ctid from ranked where rn > 1
)
insert into public.price_history_dupes_archive
  (id, listing_id, price, price_usd_equivalent, currency, observed_at, source, usd_rate_used)
select ph.id, ph.listing_id, ph.price, ph.price_usd_equivalent, ph.currency,
       ph.observed_at, ph.source, ph.usd_rate_used
from public.price_history ph
join doomed d on d.ctid = ph.ctid;

with ranked as (
  select ctid,
         row_number() over (partition by listing_id, observed_at order by ctid) as rn
  from public.price_history
)
delete from public.price_history ph
using ranked r
where r.ctid = ph.ctid and r.rn > 1;

-- 3. The key itself. From here a repeated observation is a no-op at the
--    database rather than a silent second row, which is what lets both
--    writers use ON CONFLICT instead of hoping they never overlap.
create unique index if not exists price_history_listing_observed_key
  on public.price_history (listing_id, observed_at);

comment on index public.price_history_listing_observed_key is
  'One price observation per listing per instant. Ingest writers rely on this constraint for idempotency: see src/lib/ingest/events.ts.';
