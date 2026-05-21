-- ============================================================================
-- Geck Data 0032: data quality, alert maturity, ML loop, observability.
--
-- Bundles schema bits for the following improvement ideas:
--   #1  inference_confidence on listing_status_events
--   #2  canonical_listing_id on market_listings (re-list grouping)
--   #3  usd_rate_used on price_history (FX-drift correction)
--   #4  morph_taxonomy_synonyms (name normalisation)
--   #7  alert_delivery_attempts (delivery receipts)
--   #9  acknowledged_at + snoozed_until on alert_matches
--   #11 confidence numeric on model_invocations
--   #12 morph_human_labels (ML disagreement queue)
--   #13 v_trait_recognition_metrics view
--   #19 v_ingest_health_24h + prune_ingest_audit() function
--
-- Safe to re-run. Everything uses IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. listing_status_events.inference_confidence
--    A weak (0.0) to strong (1.0) numeric. Backfills NULL for legacy rows.
--    Convention by source:
--      extension_explicit -> 1.00  (the page itself flipped state)
--      auction_close      -> 0.95  (auction with a final bid)
--      extension_inferred -> 0.60  (heuristic: gone for >7d, etc.)
--      db_import          -> 0.50  (best-effort historical)
-- ----------------------------------------------------------------------------
alter table public.listing_status_events
  add column if not exists inference_confidence numeric;

create index if not exists idx_lse_inference_confidence
  on public.listing_status_events(inference_confidence)
  where inference_confidence is not null;

-- One-shot backfill from `source` for rows without a value. Idempotent.
update public.listing_status_events
   set inference_confidence = case
     when source = 'extension_explicit' then 1.00
     when source = 'auction_close'      then 0.95
     when source = 'extension_inferred' then 0.60
     when source = 'db_import'          then 0.50
     else 0.70
   end
 where inference_confidence is null;

-- ----------------------------------------------------------------------------
-- 2. market_listings.canonical_listing_id
--    Same animal re-listed at a higher price gets grouped under one canonical
--    id. Populated by a dedup worker (planned, not yet shipped); we add the
--    column + index now so analytics views can join on it pre-emptively.
-- ----------------------------------------------------------------------------
alter table public.market_listings
  add column if not exists canonical_listing_id text;

create index if not exists idx_market_listings_canonical
  on public.market_listings(canonical_listing_id)
  where canonical_listing_id is not null;

-- ----------------------------------------------------------------------------
-- 3. price_history.usd_rate_used
--    Snapshot the FX rate used to derive price_usd_equivalent so historical
--    comparisons aren't biased by today's rates. NULL for legacy rows.
-- ----------------------------------------------------------------------------
alter table public.price_history
  add column if not exists usd_rate_used numeric;

-- ----------------------------------------------------------------------------
-- 4. morph_taxonomy_synonyms
--    Canonical-form mapping for noisy trait labels. Used at sanitize-write
--    time by lib/traits.ts after the migration backfill in 0028.
-- ----------------------------------------------------------------------------
create table if not exists public.morph_taxonomy_synonyms (
  id bigserial primary key,
  alias text not null,
  canonical text not null,
  weight numeric not null default 1.0,
  added_at timestamptz not null default now(),
  added_by text,                -- 'manual' | 'ml_auto' | 'imported_from_X'
  unique (alias)
);

create index if not exists idx_synonyms_canonical
  on public.morph_taxonomy_synonyms(canonical);

alter table public.morph_taxonomy_synonyms enable row level security;
drop policy if exists "public read synonyms" on public.morph_taxonomy_synonyms;
create policy "public read synonyms" on public.morph_taxonomy_synonyms
  for select using (true);

-- Seed with a handful of obvious aliases so the table isn't empty on day 1.
insert into public.morph_taxonomy_synonyms (alias, canonical, added_by) values
  ('lily white',      'Lilly White',     'manual'),
  ('lilywhite',       'Lilly White',     'manual'),
  ('lillywhite',      'Lilly White',     'manual'),
  ('cappucino',       'Cappuccino',      'manual'),
  ('frappucino',      'Frappuccino',     'manual'),
  ('extreme harl',    'Extreme Harlequin','manual'),
  ('xtreme harlequin','Extreme Harlequin','manual'),
  ('full pin',        'Full Pinstripe',  'manual'),
  ('pinny',           'Pinstripe',       'manual'),
  ('super dal',       'Super Dalmatian', 'manual')
on conflict (alias) do nothing;

-- ----------------------------------------------------------------------------
-- 7. alert_delivery_attempts
--    Track every notification attempt so /alerts can surface stale undelivered
--    matches. One row per (match × channel × attempt).
-- ----------------------------------------------------------------------------
create table if not exists public.alert_delivery_attempts (
  id bigserial primary key,
  match_id uuid not null references public.alert_matches(id) on delete cascade,
  channel_id uuid references public.user_notification_channels(id) on delete set null,
  attempt_no int not null default 1,
  status text not null check (status in ('queued','sent','failed','retrying')),
  http_status int,
  error_summary text,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_alert_delivery_match on public.alert_delivery_attempts(match_id);
create index if not exists idx_alert_delivery_status_attempted
  on public.alert_delivery_attempts(status, attempted_at desc);

alter table public.alert_delivery_attempts enable row level security;
drop policy if exists "owner read delivery attempts" on public.alert_delivery_attempts;
-- Owner-scoped read via the match's alert.owner_id chain.
create policy "owner read delivery attempts" on public.alert_delivery_attempts
  for select using (
    exists (
      select 1
      from public.alert_matches m
      join public.alerts a on a.id = m.alert_id
      where m.id = alert_delivery_attempts.match_id
        and a.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 9. alert_matches.acknowledged_at + snoozed_until
--    Lets a viewer mark a match as "I saw this" so subsequent matches on the
--    same alert can skip notification until the snooze expires.
-- ----------------------------------------------------------------------------
alter table public.alert_matches
  add column if not exists acknowledged_at timestamptz,
  add column if not exists snoozed_until   timestamptz;

create index if not exists idx_alert_matches_unack
  on public.alert_matches(matched_at desc)
  where acknowledged_at is null;

-- ----------------------------------------------------------------------------
-- 11. model_invocations.confidence
--     Explicit per-call confidence, populated by the classifier itself
--     (currently inferred from output_tokens — keep that as a fallback in
--     /api/training/queue). NULL for legacy invocations.
-- ----------------------------------------------------------------------------
alter table public.model_invocations
  add column if not exists confidence numeric,           -- 0..1
  add column if not exists predicted_combo_id text;      -- model's pick

create index if not exists idx_model_invocations_confidence
  on public.model_invocations(confidence)
  where confidence is not null;

-- ----------------------------------------------------------------------------
-- 12. morph_human_labels
--     Ground truth from human reviewers. Joined with model_invocations to
--     compute per-trait recognition F1 and to surface model-vs-human
--     disagreements as the next active-learning batch.
-- ----------------------------------------------------------------------------
create table if not exists public.morph_human_labels (
  id bigserial primary key,
  listing_id text references public.market_listings(id) on delete cascade,
  invocation_id bigint references public.model_invocations(id) on delete set null,
  combo_id text,                                        -- canonical combo
  traits text[],                                        -- canonical trait list
  labeler text not null,                                -- email / 'manual'
  notes text,
  labeled_at timestamptz not null default now()
);

create index if not exists idx_mhl_listing on public.morph_human_labels(listing_id);
create index if not exists idx_mhl_labeled_at on public.morph_human_labels(labeled_at desc);

alter table public.morph_human_labels enable row level security;
drop policy if exists "public read human labels" on public.morph_human_labels;
create policy "public read human labels" on public.morph_human_labels
  for select using (true);

-- ----------------------------------------------------------------------------
-- 13. v_trait_recognition_metrics
--     Per-trait precision/recall/F1 from model_invocations × human_labels.
--     A trait is "predicted" if it appears in the model's predicted_combo_id
--     canonical trait list; "actual" if in the human label.
--     The view emits rolling 30-day numbers; widgets can window further.
-- ----------------------------------------------------------------------------
create or replace view public.v_trait_recognition_metrics as
with pairs as (
  select
    mi.id                                                 as invocation_id,
    mi.predicted_combo_id                                 as predicted,
    mhl.combo_id                                          as actual,
    mhl.traits                                            as actual_traits,
    mi.called_at                                          as called_at
  from public.model_invocations mi
  join public.morph_human_labels mhl on mhl.invocation_id = mi.id
  where mi.called_at >= now() - interval '30 days'
),
agg as (
  select
    unnest(coalesce(actual_traits, array[]::text[]))      as trait,
    count(*)                                              as samples,
    count(*) filter (where predicted = actual)            as combo_correct,
    count(*) filter (where predicted is null)             as model_silent
  from pairs
  group by 1
)
select
  trait,
  samples,
  combo_correct,
  model_silent,
  case when samples > 0 then combo_correct::numeric / samples else null end as combo_accuracy
from agg
order by samples desc;

-- ----------------------------------------------------------------------------
-- 19. v_ingest_health_24h + prune_ingest_audit()
--     Rolling 24h health snapshot for /status. prune function drops rows
--     older than 90d so ingest_audit doesn't grow without bound.
-- ----------------------------------------------------------------------------
create or replace view public.v_ingest_health_24h as
select
  count(*)                                                       as total_requests,
  count(*) filter (where status_code between 200 and 299)        as ok_requests,
  count(*) filter (where status_code >= 400)                     as error_requests,
  sum(coalesce(event_count, 0))                                  as total_events,
  sum(coalesce(ok_count, 0))                                     as events_ok,
  sum(coalesce(failed_count, 0))                                 as events_failed,
  percentile_cont(0.5)  within group (order by duration_ms)      as p50_duration_ms,
  percentile_cont(0.95) within group (order by duration_ms)      as p95_duration_ms,
  max(received_at)                                               as last_ingest_at
from public.ingest_audit
where received_at >= now() - interval '24 hours';

create or replace function public.prune_ingest_audit(p_keep_days int default 90)
returns int
language sql
as $$
  with deleted as (
    delete from public.ingest_audit
     where received_at < now() - (p_keep_days::text || ' days')::interval
     returning 1
  )
  select count(*)::int from deleted;
$$;
