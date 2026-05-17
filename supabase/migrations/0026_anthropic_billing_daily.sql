-- 0026 — Mirror of Anthropic's actual daily cost report. Populated by
-- scripts/pull_anthropic_billing.py against the
-- /v1/organizations/cost_report Admin API endpoint.
--
-- The /data-admin/control "Spend (7d)" panel pairs this with
-- v_model_spend_7d so we can show Estimated $ (from token counts in
-- model_invocations) next to Actual $ (from Anthropic's billing) and
-- flag drift.

create table if not exists public.anthropic_billing_daily (
  day date primary key,
  cost_cents numeric not null default 0,
  by_model jsonb not null default '{}'::jsonb,        -- { model: cost_cents }
  by_token_type jsonb not null default '{}'::jsonb,   -- { token_type: cost_cents }
  raw jsonb,                                          -- whole bucket payload for debug
  fetched_at timestamptz not null default now()
);

create index if not exists idx_anthropic_billing_daily_day
  on public.anthropic_billing_daily(day desc);

alter table public.anthropic_billing_daily enable row level security;
drop policy if exists "public read anthropic_billing_daily" on public.anthropic_billing_daily;
create policy "public read anthropic_billing_daily" on public.anthropic_billing_daily
  for select using (true);
