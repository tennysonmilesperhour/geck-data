-- Same results, faster. morph_summary, breeder_summary and trait_upgrades
-- used to call is_training_trait() once per distinct trait string (about
-- 1,900 of them, most of them seller-questionnaire noise), and each call
-- scans the taxonomy. That made the whole-market versions take 1.5 to 2
-- seconds. This swaps the per-row call for one join against the taxonomy
-- names and synonyms, with the same rules as is_training_trait():
-- lower-cased exact match on a canonical name or synonym, and never a
-- "Diet: ..." or "Proven breeder ..." label.

create or replace function geck_data.morph_summary()
returns table (trait text, for_sale bigint, ask_p25 numeric, ask_p50 numeric, ask_p75 numeric, sold bigint, sold_p50 numeric, last_seen_at timestamptz)
language sql
stable
set search_path to ''
as $$
  with rows as (
    select unnest(l.trait_array) as trait, l.price, l.currency,
      (l.is_active and l.sold_at is null) as is_active, l.sold_at, l.last_seen_at
    from geck_data.listings l
    where coalesce(l.species, 'unknown') in ('crested', 'unknown')
      and l.price > 0 and l.price < 100000
  ),
  names as (
    select m.norm_name as norm from geck_data.crested_morph_taxonomy m
    union
    select lower(s) from geck_data.crested_morph_taxonomy m, unnest(m.synonyms) s
  ),
  real_traits as (
    select d.trait from (select distinct r.trait from rows r) d
    where lower(trim(d.trait)) in (select norm from names)
      and d.trait not ilike 'Diet:%' and d.trait not ilike 'Proven breeder%'
  )
  select r.trait,
    count(*) filter (where r.is_active),
    round(percentile_cont(0.25) within group (order by r.price) filter (where r.is_active and r.currency = 'USD')::numeric, 0),
    round(percentile_cont(0.50) within group (order by r.price) filter (where r.is_active and r.currency = 'USD')::numeric, 0),
    round(percentile_cont(0.75) within group (order by r.price) filter (where r.is_active and r.currency = 'USD')::numeric, 0),
    count(*) filter (where r.sold_at is not null),
    round(percentile_cont(0.50) within group (order by r.price) filter (where r.sold_at is not null and r.currency = 'USD')::numeric, 0),
    max(r.last_seen_at)
  from rows r join real_traits t on t.trait = r.trait
  group by r.trait
  order by 2 desc, 1;
$$;

create or replace function geck_data.breeder_summary()
returns table (seller_slug text, name text, location text, avatar_url text, for_sale bigint, ask_p50 numeric, sold bigint, top_traits text[], last_seen_at timestamptz)
language sql
stable
set search_path to ''
as $$
  with base as (
    select l.*, (l.is_active and l.sold_at is null) as for_sale_now
    from geck_data.listings l
    where l.seller_slug is not null and l.seller_slug <> ''
      and coalesce(l.species, 'unknown') in ('crested', 'unknown')
      and l.price > 0 and l.price < 100000
  ),
  agg as (
    select b.seller_slug, max(b.seller_name) as seller_name,
      count(*) filter (where b.for_sale_now) as for_sale,
      round(percentile_cont(0.5) within group (order by b.price) filter (where b.for_sale_now and b.currency = 'USD')::numeric, 0) as ask_p50,
      count(*) filter (where b.sold_at is not null) as sold,
      max(b.last_seen_at) as last_seen_at
    from base b group by b.seller_slug
  ),
  traits as (
    select b.seller_slug, t.trait, count(*) as n
    from base b, unnest(b.trait_array) t(trait)
    where b.for_sale_now
    group by 1, 2
  ),
  names as (
    select m.norm_name as norm from geck_data.crested_morph_taxonomy m
    union
    select lower(s) from geck_data.crested_morph_taxonomy m, unnest(m.synonyms) s
  ),
  real_traits as (
    select d.trait from (select distinct trait from traits) d
    where lower(trim(d.trait)) in (select norm from names)
      and d.trait not ilike 'Diet:%' and d.trait not ilike 'Proven breeder%'
  ),
  ranked as (
    select tr.seller_slug, tr.trait,
      row_number() over (partition by tr.seller_slug order by tr.n desc, tr.trait) as rk
    from traits tr join real_traits rt on rt.trait = tr.trait
  )
  select a.seller_slug,
    coalesce(nullif(s.store_name, ''), a.seller_name, a.seller_slug),
    s.location_raw, s.avatar_url, a.for_sale, a.ask_p50, a.sold,
    coalesce((select array_agg(r.trait order by r.rk) from ranked r
              where r.seller_slug = a.seller_slug and r.rk <= 3), '{}'),
    a.last_seen_at
  from agg a left join geck_data.sellers s on s.seller_slug = a.seller_slug
  order by a.for_sale desc, a.sold desc;
$$;

create or replace function geck_data.trait_upgrades(p_traits text[])
returns table (trait text, n bigint, p50 numeric, base_n bigint, base_p50 numeric)
language sql
stable
set search_path to ''
as $$
  with base as (
    select l.price, l.trait_array from geck_data.listings l
    where coalesce(l.species, 'unknown') in ('crested', 'unknown')
      and l.currency = 'USD' and l.price > 0 and l.price < 100000
      and l.trait_array @> coalesce(p_traits, '{}'::text[])
  ),
  bm as (
    select count(*) as n, round(percentile_cont(0.5) within group (order by price)::numeric, 0) as p50
    from base
  ),
  extra as (
    select t.trait, b.price from base b, unnest(b.trait_array) t(trait)
    where not (t.trait = any(coalesce(p_traits, '{}'::text[])))
  ),
  names as (
    select m.norm_name as norm from geck_data.crested_morph_taxonomy m
    union
    select lower(s) from geck_data.crested_morph_taxonomy m, unnest(m.synonyms) s
  ),
  real_traits as (
    select d.trait from (select distinct e.trait from extra e) d
    where lower(trim(d.trait)) in (select norm from names)
      and d.trait not ilike 'Diet:%' and d.trait not ilike 'Proven breeder%'
  )
  select e.trait, count(*),
    round(percentile_cont(0.5) within group (order by e.price)::numeric, 0),
    (select n from bm), (select p50 from bm)
  from extra e join real_traits r on r.trait = e.trait
  group by e.trait having count(*) >= 5
  order by 3 desc;
$$;

-- The functions run as the caller, so public visitors need to read the
-- taxonomy they now join against.
grant select on geck_data.crested_morph_taxonomy to anon, authenticated;
