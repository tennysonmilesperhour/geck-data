-- ============================================================================
-- Geck Data 0031: batch_jobs table.
--
-- Backs /api/training/batch-invoke. One row per (listing_id, model, surface)
-- pending classification. A separate worker drains the table, calls Anthropic,
-- writes the result back into model_invocations + flips status to 'done'.
--
-- Status state machine: pending -> running -> done | failed
-- ============================================================================

create table if not exists public.batch_jobs (
  id bigserial primary key,
  listing_id text not null references public.market_listings(id) on delete cascade,
  model text not null,
  surface text not null,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_summary text,
  result jsonb,
  invocation_id bigint references public.model_invocations(id) on delete set null,
  unique (listing_id, model, surface, status)
);

create index if not exists idx_batch_jobs_status_created
  on public.batch_jobs(status, created_at);
create index if not exists idx_batch_jobs_listing
  on public.batch_jobs(listing_id);

alter table public.batch_jobs enable row level security;
drop policy if exists "public read batch_jobs" on public.batch_jobs;
create policy "public read batch_jobs" on public.batch_jobs for select using (true);

-- Helper: claim the next N pending jobs for a worker. Sets status='running'
-- atomically so two workers don't race for the same row. Returns the rows
-- the worker should now process.
create or replace function public.claim_batch_jobs(p_limit int, p_worker text)
returns setof public.batch_jobs
language sql
as $$
  with claimed as (
    select id from public.batch_jobs
     where status = 'pending'
     order by created_at
     for update skip locked
     limit p_limit
  )
  update public.batch_jobs bj
     set status = 'running',
         started_at = now(),
         error_summary = coalesce(error_summary, p_worker)
   where bj.id in (select id from claimed)
  returning bj.*;
$$;
