-- A year of history from a sample of old listings.
--
-- Tracking started in May 2026, but MorphMarket listing ids are handed out
-- in order (id and posting date correlate at 0.99 across the 1,670 listings
-- whose posting date we know). So every listing posted in the past year sits
-- somewhere in one id range, and reading every Nth id from that range is a
-- fair sample of what was posted each month, including geckos that have
-- since sold. scripts/backfill_history.py does the reading and stores one row
-- per sampled id here, whatever the species, so reruns can skip ids already
-- read. Nothing here touches the live catalog tables.

create table if not exists geck_data.listing_backfill (
  listing_id text primary key,
  nid bigint generated always as (
    case when listing_id ~ '^[0-9]+$' then listing_id::bigint end
  ) stored,
  http_status integer,
  is_crested boolean,
  first_listed_at timestamptz,
  state text,
  is_sold boolean,
  name text,
  price numeric,
  currency text,
  trait_array text[],
  sex text,
  maturity text,
  sample_every integer not null,
  fetched_at timestamptz not null default now()
);

create index if not exists listing_backfill_nid on geck_data.listing_backfill (nid);
create index if not exists listing_backfill_listed on geck_data.listing_backfill (first_listed_at);
create index if not exists listing_backfill_traits on geck_data.listing_backfill using gin (trait_array);

alter table geck_data.listing_backfill enable row level security;
drop policy if exists "public read listing_backfill" on geck_data.listing_backfill;
create policy "public read listing_backfill" on geck_data.listing_backfill
  for select to anon, authenticated using (true);
grant select on geck_data.listing_backfill to anon, authenticated;

-- One row per month for the past year, by the month a listing was posted.
--   sampled      crested listings read from that month
--   est_posted   sampled x sampling step: roughly how many crested listings
--                were posted that month (a floor, since deleted listings
--                cannot be read)
--   p25/p50/p75  asking prices of the sampled listings (USD, lots excluded)
--   sold_share   share of the sampled listings now marked sold
--   gone_share   share of all sampled ids from that month that MorphMarket
--                no longer serves; a 404 has no posting date, so it is placed
--                in the month of the nearest lower id that has one
--   covered      the backfill has read back to within 3 days of this
--                month's start (samples are spaced, so it rarely lands
--                on the 1st exactly)
create or replace function geck_data.monthly_history(p_trait text default null)
returns table (
  month date,
  sampled integer,
  est_posted integer,
  priced integer,
  p25 numeric,
  p50 numeric,
  p75 numeric,
  sold_share numeric,
  gone_share numeric,
  covered boolean
)
language sql
stable
security invoker
as $$
  with span as (
    select generate_series(
      date_trunc('month', now()) - interval '12 months',
      date_trunc('month', now()),
      interval '1 month'
    )::date as month
  ),
  dated as (
    select b.*, date_trunc('month', b.first_listed_at)::date as month
    from geck_data.listing_backfill b
    where b.first_listed_at is not null
  ),
  -- One ordered pass: each 404 takes the month of the closest dated row
  -- below it (grp counts dated rows so far, so a 404 shares its group with
  -- the dated row just before it).
  grouped as (
    select b.nid, b.http_status, b.first_listed_at,
      count(b.first_listed_at) over (order by b.nid) as grp
    from geck_data.listing_backfill b
    where b.nid is not null
  ),
  gone as (
    select x.month
    from (
      select g.http_status,
        first_value(date_trunc('month', g.first_listed_at)::date)
          over (partition by g.grp order by g.nid) as month
      from grouped g
    ) x
    where x.http_status = 404
  ),
  reach as (
    select min(first_listed_at) as lo from dated
  ),
  crested as (
    select d.*
    from dated d
    where d.is_crested
      and (p_trait is null or d.trait_array @> array[p_trait])
  )
  select s.month,
    count(c.listing_id)::int as sampled,
    coalesce(sum(c.sample_every), 0)::int as est_posted,
    count(c.listing_id) filter (where c.currency = 'USD' and c.price > 0 and c.price < 100000
      and not geck_data._looks_like_group_lot(c.name, false))::int as priced,
    round((percentile_cont(0.25) within group (order by c.price) filter (
      where c.currency = 'USD' and c.price > 0 and c.price < 100000
        and not geck_data._looks_like_group_lot(c.name, false)))::numeric, 0),
    round((percentile_cont(0.50) within group (order by c.price) filter (
      where c.currency = 'USD' and c.price > 0 and c.price < 100000
        and not geck_data._looks_like_group_lot(c.name, false)))::numeric, 0),
    round((percentile_cont(0.75) within group (order by c.price) filter (
      where c.currency = 'USD' and c.price > 0 and c.price < 100000
        and not geck_data._looks_like_group_lot(c.name, false)))::numeric, 0),
    round(avg(c.is_sold::int)::numeric, 2),
    (
      select round(g.n::numeric / nullif(g.n + d.n, 0), 2)
      from (select count(*) as n from gone gg where gg.month = s.month) g,
           (select count(*) as n from dated d2 where d2.month = s.month) d
    ),
    coalesce((select r.lo from reach r) <= s.month + interval '3 days', false)
  from span s
  left join crested c on c.month = s.month
  group by s.month
  order by s.month;
$$;

grant execute on function geck_data.monthly_history(text) to anon, authenticated;
