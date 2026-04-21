-- ============================================================================
-- Geck Inspect — 0006: breeding schema
--
-- Adds user-tracked breeding records that back the /market Supply tab. Each
-- table is owner-scoped (authenticated users can only see their own rows);
-- admins can SELECT everything for the aggregate projections the Supply tab
-- shows.
--
-- Design notes:
--   - breeding_pairs  ← the female+male pair a user is tracking
--   - clutches        ← one row per laid clutch under that pair
--   - hatchlings      ← one row per hatched juvenile (combined with a
--                       best-guess morph the user selects from combo_catalog)
--
-- The projection view v_supply_pipeline_monthly produces one row per
-- (month, combo) with the projected number of hatchlings we'd expect
-- across the user base, 9 months forward. It uses very conservative base
-- rates for pairs that haven't yet laid a clutch (default: 4 fertile
-- clutches/season, 2 eggs per clutch).
--
-- Safe to re-run.
-- ============================================================================

-- Relies on public.is_admin() from 0003.
-- Relies on public.combo_catalog from 0005 (breeding combos reference it).

-- ----------------------------------------------------------------------------
-- 1. breeding_pairs
-- ----------------------------------------------------------------------------
create table if not exists public.breeding_pairs (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  nickname     text,
  female_name  text,
  female_morph text,                              -- free text for now
  male_name    text,
  male_morph   text,
  combo_name   text references public.combo_catalog(combo_name),
  active       boolean not null default true,
  paired_at    date default current_date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_breeding_pairs_owner
  on public.breeding_pairs(owner_id);
create index if not exists idx_breeding_pairs_active
  on public.breeding_pairs(active) where active;
create index if not exists idx_breeding_pairs_combo
  on public.breeding_pairs(combo_name);

-- ----------------------------------------------------------------------------
-- 2. clutches
-- ----------------------------------------------------------------------------
create table if not exists public.clutches (
  id                 uuid primary key default gen_random_uuid(),
  pair_id            uuid not null references public.breeding_pairs(id) on delete cascade,
  laid_on            date not null,
  expected_hatch_on  date,                       -- nullable; computed if absent
  egg_count          integer not null default 2 check (egg_count between 0 and 6),
  fertile_count      integer check (fertile_count is null or fertile_count between 0 and egg_count),
  notes              text,
  created_at         timestamptz not null default now()
);

-- Default expected-hatch = laid_on + ~65 days if not supplied.
create or replace function public.clutches_default_hatch()
returns trigger
language plpgsql
as $$
begin
  if new.expected_hatch_on is null then
    new.expected_hatch_on := new.laid_on + interval '65 days';
  end if;
  return new;
end;
$$;

drop trigger if exists clutches_default_hatch_tr on public.clutches;
create trigger clutches_default_hatch_tr
  before insert on public.clutches
  for each row execute function public.clutches_default_hatch();

create index if not exists idx_clutches_pair on public.clutches(pair_id);
create index if not exists idx_clutches_expected_hatch on public.clutches(expected_hatch_on);

-- ----------------------------------------------------------------------------
-- 3. hatchlings
-- ----------------------------------------------------------------------------
create table if not exists public.hatchlings (
  id            uuid primary key default gen_random_uuid(),
  clutch_id     uuid not null references public.clutches(id) on delete cascade,
  hatched_on    date not null default current_date,
  morph_guess   text references public.combo_catalog(combo_name),
  sex           text check (sex is null or sex in ('male','female','unknown')),
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_hatchlings_clutch on public.hatchlings(clutch_id);
create index if not exists idx_hatchlings_hatched on public.hatchlings(hatched_on desc);

-- ----------------------------------------------------------------------------
-- 4. RLS — owner read/write own; admin reads everything.
-- ----------------------------------------------------------------------------
alter table public.breeding_pairs enable row level security;
alter table public.clutches       enable row level security;
alter table public.hatchlings     enable row level security;

-- breeding_pairs
drop policy if exists "owner crud breeding_pairs" on public.breeding_pairs;
create policy "owner crud breeding_pairs" on public.breeding_pairs
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "admin read breeding_pairs" on public.breeding_pairs;
create policy "admin read breeding_pairs" on public.breeding_pairs
  for select using (public.is_admin());

-- clutches — owner via the pair
drop policy if exists "owner crud clutches" on public.clutches;
create policy "owner crud clutches" on public.clutches
  for all
  using (
    exists (
      select 1 from public.breeding_pairs p
      where p.id = clutches.pair_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.breeding_pairs p
      where p.id = clutches.pair_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "admin read clutches" on public.clutches;
create policy "admin read clutches" on public.clutches
  for select using (public.is_admin());

-- hatchlings — owner via the clutch's pair
drop policy if exists "owner crud hatchlings" on public.hatchlings;
create policy "owner crud hatchlings" on public.hatchlings
  for all
  using (
    exists (
      select 1
      from public.clutches c
      join public.breeding_pairs p on p.id = c.pair_id
      where c.id = hatchlings.clutch_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.clutches c
      join public.breeding_pairs p on p.id = c.pair_id
      where c.id = hatchlings.clutch_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "admin read hatchlings" on public.hatchlings;
create policy "admin read hatchlings" on public.hatchlings
  for select using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. v_supply_pipeline_monthly — aggregate supply projection for the Supply
-- tab. Runs with security_invoker so RLS on breeding_pairs + clutches
-- applies to the caller: owners see their own pairs, admins see all pairs.
-- The view aggregates to (month, combo) so no owner identity leaks.
--
-- The projection combines:
--   a) Confirmed clutches: eggs expected to hatch in the month of
--      expected_hatch_on (fertile_count preferred, else 80% of egg_count)
--   b) Projected future clutches from active pairs: a seasonal clutch rate
--      (peaks in spring/summer) × 2 eggs/clutch × 80% fertility across the
--      next 9 months, attributed to the pair's combo_name
-- ----------------------------------------------------------------------------
create or replace view public.v_supply_pipeline_monthly
with (security_invoker = true)
as
with
-- Next 9 calendar months starting with the current month.
months as (
  select generate_series(
    date_trunc('month', now())::date,
    (date_trunc('month', now()) + interval '8 months')::date,
    interval '1 month'
  )::date as month_start
),
-- Confirmed clutches: eggs expected to hatch in a month.
confirmed as (
  select
    date_trunc('month', c.expected_hatch_on)::date as month_start,
    coalesce(p.combo_name, 'Unknown') as combo_name,
    -- Prefer fertile_count when given, else expect 80% of egg_count to hatch.
    sum(
      coalesce(c.fertile_count, (c.egg_count * 0.8)::int)
    ) as projected
  from public.clutches c
  join public.breeding_pairs p on p.id = c.pair_id
  where c.expected_hatch_on >= date_trunc('month', now())::date
    and c.expected_hatch_on < (date_trunc('month', now()) + interval '9 months')::date
  group by 1, 2
),
-- Projected future clutches from active pairs, with a seasonal shape
-- (Apr..Aug peak, Sep..Mar lower). 2 eggs/clutch × fertility factor.
active_pair_counts as (
  select
    coalesce(p.combo_name, 'Unknown') as combo_name,
    count(*) as pair_n
  from public.breeding_pairs p
  where p.active
  group by p.combo_name
),
seasonal as (
  select
    m.month_start,
    extract(month from m.month_start)::int as mo,
    case extract(month from m.month_start)::int
      when 4 then 0.9 when 5 then 1.0 when 6 then 0.9
      when 7 then 0.7 when 8 then 0.45
      when 3 then 0.6 when 9 then 0.25
      else 0.1
    end as clutch_rate
  from months m
),
projected as (
  select
    s.month_start,
    a.combo_name,
    round(a.pair_n * s.clutch_rate * 2.0 * 0.8)::int as projected
  from seasonal s
  cross join active_pair_counts a
)
select
  month_start,
  combo_name,
  coalesce(sum(projected), 0)::int as projected_juveniles
from (
  select * from confirmed
  union all
  select * from projected
) u
group by month_start, combo_name
order by month_start, combo_name;

-- Views inherit RLS from base tables; hatchlings + breeding_pairs enforce
-- admin-only SELECT across other users' rows, so only admin users can read
-- the full projection. Owners still see their own share via the policies
-- above. The /market Supply tab reads the view via the admin path.
