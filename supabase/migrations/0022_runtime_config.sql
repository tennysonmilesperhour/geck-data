-- 0022 — Runtime configuration knobs that the /data-admin/control panel
-- can change without a redeploy. The eval script and the
-- recognize-gecko-morph edge function read these instead of (or as a
-- preferred override on top of) their existing env-var defaults, so
-- raising a daily cap is a single SQL update + automatic next-call pickup.
--
-- Every change is mirrored into runtime_config_history so we have an
-- audit trail of who turned what dial when.

create table if not exists public.runtime_config (
  key text primary key,
  value jsonb not null,
  value_kind text not null check (value_kind in ('integer','number','boolean','string','json')),
  description text,
  min_value numeric,
  max_value numeric,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.runtime_config_history (
  id bigserial primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz not null default now(),
  changed_by text
);

create index if not exists idx_runtime_config_history_key_time
  on public.runtime_config_history(key, changed_at desc);

-- Trigger: every INSERT and UPDATE writes a history row. DELETE is
-- intentionally not audited because keys should never be deleted in
-- practice (the panel UI hides delete; SQL can still do it manually).
create or replace function public.runtime_config_audit() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.runtime_config_history (key, old_value, new_value, changed_by)
    values (new.key, null, new.value, new.updated_by);
    return new;
  elsif (tg_op = 'UPDATE') then
    if old.value is distinct from new.value then
      insert into public.runtime_config_history (key, old_value, new_value, changed_by)
      values (new.key, old.value, new.value, new.updated_by);
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists runtime_config_audit_trigger on public.runtime_config;
create trigger runtime_config_audit_trigger
  after insert or update on public.runtime_config
  for each row execute function public.runtime_config_audit();

alter table public.runtime_config enable row level security;
alter table public.runtime_config_history enable row level security;

drop policy if exists "public read runtime_config" on public.runtime_config;
create policy "public read runtime_config" on public.runtime_config
  for select using (true);

drop policy if exists "public read runtime_config_history" on public.runtime_config_history;
create policy "public read runtime_config_history" on public.runtime_config_history
  for select using (true);

-- Seed the knobs the /data-admin/control panel needs day one. Idempotent
-- via on conflict do nothing so re-running this migration in a recovery
-- scenario doesn't reset a value the admin has since tuned.
insert into public.runtime_config (key, value, value_kind, description, min_value, max_value, updated_by)
values
  ('eval_daily_cap_calls', to_jsonb(300), 'integer',
   'Max total images sent to recognize-gecko-morph per UTC day from scripts/eval_morph_id.py. '
   || 'Zero disables the cap. Mirror of the EVAL_DAILY_CAP_CALLS env var; runtime wins.',
   0, 5000, 'migration_0022'),
  ('morph_id_per_ip_daily', to_jsonb(50), 'integer',
   'Soft cap on production MorphID calls per source-IP per UTC day. Read by the edge function. '
   || 'Zero disables the cap.',
   0, 1000, 'migration_0022')
on conflict (key) do nothing;
