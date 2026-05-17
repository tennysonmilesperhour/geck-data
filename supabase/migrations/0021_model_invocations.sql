-- 0021 — Per-call log of every Anthropic model invocation that hits
-- the recognize-gecko-morph edge function (and any future LLM-backed
-- edge function that opts in). One row per upstream Anthropic request,
-- written from the edge function via the geck-data service role.
--
-- Powers the /data-admin/control "Spend (7d)" panel and gives us a
-- queryable substrate for cost dashboards instead of the Anthropic
-- billing PDF.

create table if not exists public.model_invocations (
  id bigserial primary key,
  called_at timestamptz not null default now(),

  -- Which feature called Claude. Free-text so we can add new surfaces
  -- without a schema change; canonical values today:
  --   'morph_id_production' — Recognition.jsx, TrainModel.jsx (paying users)
  --   'morph_id_eval'       — scripts/eval_morph_id.py
  --   'morph_id_unknown'    — fallback when the caller didn't tag itself
  surface text not null,

  -- Resolved Claude model id at request time
  model text not null,

  -- Tokens reported by Anthropic in the response usage block
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_creation_tokens int,

  -- Estimated USD cost in cents (numeric for sub-cent precision).
  -- Computed in the edge function from a known price table so the
  -- value is frozen at write time even if prices change later.
  est_cost_cents numeric(12,4),

  -- Provenance
  user_id uuid,
  tier text,
  is_admin boolean default false,
  photo_count int,
  few_shot_count int,

  -- Outcome
  http_status int,
  error_code text,
  duration_ms int,
  request_id text
);

create index if not exists idx_model_invocations_called_at
  on public.model_invocations(called_at desc);
create index if not exists idx_model_invocations_surface_called_at
  on public.model_invocations(surface, called_at desc);
create index if not exists idx_model_invocations_error_code
  on public.model_invocations(error_code)
  where error_code is not null;
create index if not exists idx_model_invocations_user_called_at
  on public.model_invocations(user_id, called_at desc)
  where user_id is not null;

-- RLS: only the service role writes (from the edge function). Public
-- reads are allowed because /data-admin is the only consumer and it's
-- already gated by ADMIN_USER_ID at the route layer. If we ever expose
-- this table outside /data-admin we should tighten this to admin-only.
alter table public.model_invocations enable row level security;
drop policy if exists "public read model_invocations" on public.model_invocations;
create policy "public read model_invocations" on public.model_invocations
  for select using (true);

-- Convenience view: 7-day spend rollup by day x surface x model, for
-- the /data-admin/control "Spend (7d)" panel.
create or replace view public.v_model_spend_7d as
  select
    date_trunc('day', called_at) as day,
    surface,
    model,
    count(*) as call_count,
    sum(coalesce(input_tokens, 0))  as input_tokens,
    sum(coalesce(output_tokens, 0)) as output_tokens,
    sum(coalesce(est_cost_cents, 0)) as cost_cents,
    count(*) filter (where error_code is not null) as error_count
  from public.model_invocations
  where called_at >= now() - interval '7 days'
  group by 1, 2, 3
  order by 1 desc, cost_cents desc;
