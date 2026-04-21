-- ============================================================================
-- Geck Inspect — 0004: ingest audit
--
-- Until now, the log of "what did the extension push and when?" was scattered
-- across the destination tables (price_drops, listing_status_events, etc).
-- That answers "is anything flowing?" but not "which POST carried which
-- events, and which failed?".
--
-- This migration adds a single append-only table that receives one row per
-- /api/ingest request, written by the route handler using the service role.
-- Admins can read it; only the service role writes it.
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.ingest_audit (
  id              uuid primary key default gen_random_uuid(),
  received_at     timestamptz not null default now(),
  source_tag      text,                    -- free-form "extension", "chrome-123", etc.
  content_type    text,
  event_count     integer not null default 0,
  ok_count        integer not null default 0,
  failed_count    integer not null default 0,
  duration_ms     integer,
  status_code     integer,
  error_summary   text,
  event_types     text[],                  -- distinct event types in the batch
  file_count      integer,                 -- multipart path: how many files
  client_ip_hash  text,                    -- sha256 of (ip + daily salt); never raw IP
  user_agent      text
);

create index if not exists idx_ingest_audit_received_at
  on public.ingest_audit(received_at desc);
create index if not exists idx_ingest_audit_status_code
  on public.ingest_audit(status_code, received_at desc);
create index if not exists idx_ingest_audit_event_types
  on public.ingest_audit using gin (event_types);

alter table public.ingest_audit enable row level security;

-- Admins read. No public insert — writes come from the server-side route
-- handler using the service-role key (which bypasses RLS), so the table
-- cannot be polluted by anon or authenticated callers.
drop policy if exists "admin read ingest_audit" on public.ingest_audit;
create policy "admin read ingest_audit" on public.ingest_audit
  for select using (public.is_admin());

drop policy if exists "admin delete ingest_audit" on public.ingest_audit;
create policy "admin delete ingest_audit" on public.ingest_audit
  for delete using (public.is_admin());

-- ----------------------------------------------------------------------------
-- v_ingest_daily — convenience view for the admin ingest timeline. Buckets
-- the last 30 days and surfaces success rate + most common event types.
-- ----------------------------------------------------------------------------
create or replace view public.v_ingest_daily as
select
  date_trunc('day', received_at) as day,
  count(*)                              as requests,
  sum(event_count)                      as events,
  sum(ok_count)                         as ok,
  sum(failed_count)                     as failed,
  round(
    case when sum(event_count) = 0 then 100
         else 100.0 * sum(ok_count)::numeric / nullif(sum(event_count), 0)
    end,
    1
  )                                     as ok_pct,
  avg(duration_ms)::integer             as avg_duration_ms
from public.ingest_audit
where received_at >= now() - interval '30 days'
group by 1
order by 1 desc;
