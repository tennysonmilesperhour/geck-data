-- Read-only functions behind the value report (price check) and morph pages.
--
-- A crested gecko is priced like livestock more than like a collectible:
-- value depends on sex and on how grown the animal is, then on its genes.
-- These functions expose exactly those three cuts. All read
-- geck_data.listings, crested and unclassified rows, USD prices only, and
-- use every listing we have seen (active, sold or gone) because every one
-- of them is a real asking price. Sold-only views stay in sold_price_band.
--
--   value_grid(traits)     median asking price by age class x sex
--   growth_curve(traits)   median asking price by weight bucket x sex
--   trait_upgrades(traits) what adding one more real trait does to price
--   market_baseline()      the typical crested gecko, for "x times" ratios

create or replace function geck_data._age_class(p_maturity text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case lower(coalesce(p_maturity, ''))
    when 'baby' then 'hatchling'
    when 'hatchling' then 'hatchling'
    when 'juvenile' then 'juvenile'
    when 'subadult' then 'subadult'
    when 'adult' then 'adult'
    else null
  end;
$$;

create or replace function geck_data._sex_class(p_sex text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case lower(coalesce(p_sex, ''))
    when 'male' then 'male'
    when 'female' then 'female'
    when 'mixed' then null
    else 'unsexed'
  end;
$$;

-- Rows come back for every age x sex cell plus "any" totals (any age for a
-- sex, any sex for an age, and everything), so the price check can fall
-- back to a broader group when one cell is thin. Listings with no stated
-- age count toward the "any age" rows only.
create or replace function geck_data.value_grid(p_traits text[])
returns table (age_class text, sex_class text, n bigint, p25 numeric, p50 numeric, p75 numeric)
language sql
stable
set search_path to ''
as $$
  with rows as (
    select geck_data._age_class(l.maturity) as age_class,
      geck_data._sex_class(l.sex) as sex_class,
      l.price
    from geck_data.listings l
    where coalesce(l.species, 'unknown') in ('crested', 'unknown')
      and l.currency = 'USD' and l.price > 0 and l.price < 100000
      and l.trait_array @> coalesce(p_traits, '{}'::text[])
  ),
  g as (
    select
      case when grouping(r.age_class) = 1 then 'any' else r.age_class end as age_class,
      case when grouping(r.sex_class) = 1 then 'any' else r.sex_class end as sex_class,
      count(*) as n,
      round(percentile_cont(0.25) within group (order by r.price)::numeric, 0) as p25,
      round(percentile_cont(0.50) within group (order by r.price)::numeric, 0) as p50,
      round(percentile_cont(0.75) within group (order by r.price)::numeric, 0) as p75
    from rows r
    group by grouping sets ((r.age_class, r.sex_class), (r.age_class), (r.sex_class), ())
  )
  select * from g where g.age_class is not null and g.sex_class is not null;
$$;

create or replace function geck_data.growth_curve(p_traits text[])
returns table (bucket int, label text, sex_class text, n bigint, p50 numeric)
language sql
stable
set search_path to ''
as $$
  with rows as (
    select l.weight_grams w, geck_data._sex_class(l.sex) as sex_class, l.price
    from geck_data.listings l
    where coalesce(l.species, 'unknown') in ('crested', 'unknown')
      and l.currency = 'USD' and l.price > 0 and l.price < 100000
      and l.weight_grams > 0 and l.weight_grams < 150
      and l.trait_array @> coalesce(p_traits, '{}'::text[])
  ),
  b as (
    select case
        when w < 5 then 0 when w < 10 then 1 when w < 15 then 2 when w < 20 then 3
        when w < 30 then 4 when w < 40 then 5 when w < 50 then 6 else 7 end as bucket,
      sex_class, price
    from rows
    where sex_class is not null
  )
  select b.bucket,
    (array['under 5g','5 to 10g','10 to 15g','15 to 20g','20 to 30g','30 to 40g','40 to 50g','50g and up'])[b.bucket + 1],
    s.sex_class,
    count(*),
    round(percentile_cont(0.5) within group (order by b.price)::numeric, 0)
  from b
  cross join lateral (values (b.sex_class), ('all')) s(sex_class)
  group by 1, 2, 3
  order by 1, 3;
$$;

create or replace function geck_data.trait_upgrades(p_traits text[])
returns table (trait text, n bigint, p50 numeric, base_n bigint, base_p50 numeric)
language sql
stable
set search_path to ''
as $$
  with base as (
    select l.price, l.trait_array
    from geck_data.listings l
    where coalesce(l.species, 'unknown') in ('crested', 'unknown')
      and l.currency = 'USD' and l.price > 0 and l.price < 100000
      and l.trait_array @> coalesce(p_traits, '{}'::text[])
  ),
  bm as (
    select count(*) as n,
      round(percentile_cont(0.5) within group (order by price)::numeric, 0) as p50
    from base
  ),
  extra as (
    select t.trait, b.price
    from base b, unnest(b.trait_array) t(trait)
    where not (t.trait = any(coalesce(p_traits, '{}'::text[])))
  ),
  real_traits as (
    select d.trait from (select distinct e.trait from extra e) d
    where geck_data.is_training_trait(d.trait)
  )
  select e.trait, count(*),
    round(percentile_cont(0.5) within group (order by e.price)::numeric, 0),
    (select n from bm), (select p50 from bm)
  from extra e
  join real_traits r on r.trait = e.trait
  group by e.trait
  having count(*) >= 5
  order by 3 desc;
$$;

create or replace function geck_data.market_baseline()
returns table (n bigint, p50 numeric)
language sql
stable
set search_path to ''
as $$
  select count(*), round(percentile_cont(0.5) within group (order by l.price)::numeric, 0)
  from geck_data.listings l
  where coalesce(l.species, 'unknown') in ('crested', 'unknown')
    and l.currency = 'USD' and l.price > 0 and l.price < 100000;
$$;

grant execute on function geck_data._age_class(text) to anon, authenticated;
grant execute on function geck_data._sex_class(text) to anon, authenticated;
grant execute on function geck_data.value_grid(text[]) to anon, authenticated;
grant execute on function geck_data.growth_curve(text[]) to anon, authenticated;
grant execute on function geck_data.trait_upgrades(text[]) to anon, authenticated;
grant execute on function geck_data.market_baseline() to anon, authenticated;
