-- ============================================================================
-- Geck Inspect — 0003: admin analytics
--
-- Adds the three tables that back the /admin/analytics dashboard:
--
--   1. profiles        — extends auth.users with a role (user | admin).
--                        Used by RLS on every admin-only read below, and by
--                        the Next.js admin gate for /admin/* routes.
--   2. user_events     — append-only product telemetry. Populated by
--                        src/lib/telemetry.ts (trackEvent / trackPageView)
--                        on the web app, and by any external source that
--                        POSTs into the Supabase REST API with the anon key.
--                        Every row carries a `source` tag so we can slice
--                        events coming in from the browser extension, the
--                        scraper, or future inspectors alongside geck-inspect.
--   3. error_logs      — frontend + global handler error capture. Populated
--                        by reportError() + installGlobalErrorHandlers().
--
-- Plus a convenience view `v_daily_activity` for 90-day DAU/event-count
-- charts without scanning the full table, and an `is_admin()` helper that
-- every RLS policy below reuses so admin checks stay in one place.
--
-- Safe to re-run. Everything uses IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles — one row per auth user, with role
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);

-- Auto-provision a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill existing users who pre-date this migration.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. is_admin() — shared predicate used by every admin RLS policy
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. user_events — product telemetry
-- ----------------------------------------------------------------------------
create table if not exists public.user_events (
  id           uuid primary key default gen_random_uuid(),
  event_name   text not null,
  user_email   text,
  page         text,
  session_id   text,
  source       text,                 -- 'geck-inspect' | 'extension' | future sources
  properties   jsonb,
  created_by   uuid references auth.users(id) on delete set null,
  created_date timestamptz not null default now()
);

create index if not exists idx_user_events_created_date
  on public.user_events(created_date desc);
create index if not exists idx_user_events_name_date
  on public.user_events(event_name, created_date desc);
create index if not exists idx_user_events_email_date
  on public.user_events(user_email, created_date desc);
create index if not exists idx_user_events_page_date
  on public.user_events(page, created_date desc);
create index if not exists idx_user_events_source_date
  on public.user_events(source, created_date desc);
create index if not exists idx_user_events_session
  on public.user_events(session_id);

-- ----------------------------------------------------------------------------
-- 4. error_logs — frontend + global handler errors
-- ----------------------------------------------------------------------------
create table if not exists public.error_logs (
  id            uuid primary key default gen_random_uuid(),
  level         text not null default 'error' check (level in ('error','warning','info')),
  message       text not null,
  stack         text,
  url           text,
  user_email    text,
  user_agent    text,
  source        text,               -- same tagging as user_events
  context       jsonb,
  resolved      boolean not null default false,
  resolved_by   uuid references auth.users(id) on delete set null,
  resolved_date timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_date  timestamptz not null default now()
);

create index if not exists idx_error_logs_created_date
  on public.error_logs(created_date desc);
create index if not exists idx_error_logs_resolved_date
  on public.error_logs(resolved, created_date desc);
create index if not exists idx_error_logs_email
  on public.error_logs(user_email);
create index if not exists idx_error_logs_source_date
  on public.error_logs(source, created_date desc);

-- ----------------------------------------------------------------------------
-- 5. RLS — anon can INSERT, admins can SELECT/UPDATE/DELETE
-- ----------------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.user_events enable row level security;
alter table public.error_logs  enable row level security;

-- profiles: owner reads own row, admins read any.
drop policy if exists "owner read profile" on public.profiles;
create policy "owner read profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "admin read profiles" on public.profiles;
create policy "admin read profiles" on public.profiles
  for select using (public.is_admin());

drop policy if exists "admin update profiles" on public.profiles;
create policy "admin update profiles" on public.profiles
  for update using (public.is_admin());

-- user_events: anyone (anon + authenticated) can INSERT; admins read/modify.
drop policy if exists "anyone insert user_events" on public.user_events;
create policy "anyone insert user_events" on public.user_events
  for insert with check (true);

drop policy if exists "admin read user_events" on public.user_events;
create policy "admin read user_events" on public.user_events
  for select using (public.is_admin());

drop policy if exists "admin update user_events" on public.user_events;
create policy "admin update user_events" on public.user_events
  for update using (public.is_admin());

drop policy if exists "admin delete user_events" on public.user_events;
create policy "admin delete user_events" on public.user_events
  for delete using (public.is_admin());

-- error_logs: same pattern.
drop policy if exists "anyone insert error_logs" on public.error_logs;
create policy "anyone insert error_logs" on public.error_logs
  for insert with check (true);

drop policy if exists "admin read error_logs" on public.error_logs;
create policy "admin read error_logs" on public.error_logs
  for select using (public.is_admin());

drop policy if exists "admin update error_logs" on public.error_logs;
create policy "admin update error_logs" on public.error_logs
  for update using (public.is_admin());

drop policy if exists "admin delete error_logs" on public.error_logs;
create policy "admin delete error_logs" on public.error_logs
  for delete using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 6. v_daily_activity — 90-day rollup for DAU + event_count charts
-- ----------------------------------------------------------------------------
create or replace view public.v_daily_activity as
select
  date_trunc('day', created_date) as day,
  count(distinct user_email) filter (where user_email is not null) as active_users,
  count(*)                                                          as event_count
from public.user_events
where created_date >= now() - interval '90 days'
group by 1
order by 1 desc;

-- The view inherits RLS from user_events, so only admins can read it.

-- ----------------------------------------------------------------------------
-- 7. Making your first admin
--
--     Bootstrap: after running this migration, promote yourself by running
--     this in the SQL Editor (replace the email):
--
--       update public.profiles set role = 'admin'
--       where email = 'you@example.com';
--
--     The is_admin() check will then unlock every /admin/* page.
-- ----------------------------------------------------------------------------
