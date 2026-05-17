-- 0025 — Add ip_hash to model_invocations so the recognize-gecko-morph
-- edge function can enforce runtime_config.morph_id_per_ip_daily.
--
-- We store a SHA-256(salt + ip) hash, not the raw IP, so the table
-- doesn't carry PII even if the runtime_config sink leaks. The salt
-- lives in the edge function's IP_HASH_SALT env var.
--
-- A partial index lets the per-IP today-count query stay sub-millisecond
-- without bloating the index on legacy rows where ip_hash is null.

alter table public.model_invocations
  add column if not exists ip_hash text;

create index if not exists idx_model_invocations_ip_hash_called_at
  on public.model_invocations(ip_hash, called_at desc)
  where ip_hash is not null;
