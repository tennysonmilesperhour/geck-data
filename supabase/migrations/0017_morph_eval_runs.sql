-- 0017 — Persistence for Morph ID eval runs.
--
-- Each row records one execution of scripts/eval_morph_id.py against the
-- geck-inspect recognize-gecko-morph edge function. The /data-admin/training/
-- evals dashboard reads from here to chart accuracy over time as the prompt
-- is tuned, the verified training set grows, or the underlying model
-- upgrades.

create table if not exists public.morph_eval_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','failed')),

  -- What we evaluated against
  model text,
  taxonomy_version text,
  split text not null default 'test',
  eval_set_size int not null default 0,

  -- Headline metrics
  primary_morph_top1_accuracy numeric,
  primary_morph_top3_accuracy numeric,
  genetic_jaccard_avg numeric,
  base_color_accuracy numeric,

  -- Drilldown payloads
  per_trait_metrics jsonb default '{}'::jsonb,  -- {trait_id: {precision, recall, f1, support}}
  top_confusions   jsonb default '[]'::jsonb,   -- [{label, predicted, count}]

  -- Provenance
  prompt_fingerprint text,
  notes text,
  triggered_by text default 'manual',
  error_message text
);

create index if not exists idx_morph_eval_runs_started_at
  on public.morph_eval_runs(started_at desc);
create index if not exists idx_morph_eval_runs_status
  on public.morph_eval_runs(status);
create index if not exists idx_morph_eval_runs_model
  on public.morph_eval_runs(model);

alter table public.morph_eval_runs enable row level security;
drop policy if exists "public read morph_eval_runs" on public.morph_eval_runs;
create policy "public read morph_eval_runs" on public.morph_eval_runs
  for select using (true);
