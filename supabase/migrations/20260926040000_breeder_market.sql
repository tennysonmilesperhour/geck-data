-- One row per breeder, built on listing_market_mv, answering what a buyer
-- or another breeder asks about a store:
--   How big and how established?   listed now, sold, first seen
--   What do they focus on?          top morphs, share of their listings
--   How do they price?              median of (price / similar geckos'
--                                   middle price) across their listings,
--                                   and how many sit in the low, typical
--                                   and high quarter of similar geckos
--   What stage do they sell at?     share hatchlings, share sexed female
-- Only price-comparable (USD) listings feed the pricing columns.

create or replace view geck_data.breeder_market_v
with (security_invoker = true)
as
with l as (
  select * from geck_data.listing_market_mv
  where seller_slug is not null and seller_slug <> ''
),
agg as (
  select l.seller_slug,
    max(l.seller_name) as seller_name,
    count(*) filter (where l.for_sale) as for_sale,
    count(*) filter (where l.sold_at is not null) as sold,
    min(l.first_seen_at) as first_seen_at,
    max(l.last_seen_at) as last_seen_at,
    round(percentile_cont(0.5) within group (order by l.price)
      filter (where l.for_sale and l.currency = 'USD')::numeric, 0) as ask_p50,
    round(percentile_cont(0.5) within group (order by l.ratio)
      filter (where l.ratio is not null)::numeric, 2) as price_ratio,
    count(*) filter (where l.ratio is not null) as priced_n,
    count(*) filter (where l.position = 'low') as n_low,
    count(*) filter (where l.position = 'typical') as n_typical,
    count(*) filter (where l.position = 'high') as n_high,
    round(avg((l.age_class = 'hatchling')::int)
      filter (where l.age_class is not null)::numeric, 2) as share_hatchling,
    round(avg((l.sex_class = 'female')::int)
      filter (where l.sex_class is not null)::numeric, 2) as share_female
  from l
  group by l.seller_slug
),
names as (
  select m.norm_name as norm from geck_data.crested_morph_taxonomy m
  union
  select lower(s) from geck_data.crested_morph_taxonomy m, unnest(m.synonyms) s
),
traits as (
  select l.seller_slug, t.trait, count(*) as n
  from l, unnest(l.trait_array) t(trait)
  where lower(trim(t.trait)) in (select norm from names)
    and t.trait not ilike 'Diet:%' and t.trait not ilike 'Proven breeder%'
  group by 1, 2
),
ranked as (
  select tr.*, row_number() over (partition by tr.seller_slug order by tr.n desc, tr.trait) as rk
  from traits tr
)
select a.seller_slug,
  coalesce(nullif(s.store_name, ''), a.seller_name, a.seller_slug) as name,
  s.location_raw as location,
  s.avatar_url,
  a.for_sale, a.sold, a.first_seen_at, a.last_seen_at, a.ask_p50,
  a.price_ratio, a.priced_n, a.n_low, a.n_typical, a.n_high,
  a.share_hatchling, a.share_female,
  coalesce((select array_agg(r.trait order by r.rk) from ranked r
            where r.seller_slug = a.seller_slug and r.rk <= 5), '{}') as top_traits,
  coalesce((select array_agg(r.n order by r.rk) from ranked r
            where r.seller_slug = a.seller_slug and r.rk <= 5), '{}') as top_trait_counts
from agg a
left join geck_data.sellers s on s.seller_slug = a.seller_slug;

grant select on geck_data.breeder_market_v to anon, authenticated;

-- data_health(): the handful of numbers the public status page shows so a
-- visitor can judge how current the prices are.
create or replace function geck_data.data_health()
returns table (
  for_sale bigint,
  rechecked_14d bigint,
  tagged bigint,
  with_store bigint,
  first_seen date,
  last_checked timestamptz,
  sold bigint,
  sold_from date,
  sold_to date,
  last_seen_by_week jsonb
)
language sql
stable
set search_path to ''
as $$
  with m as (select * from geck_data.listing_market_mv),
  latest as (select max(last_seen_at) as t from m)
  select
    count(*) filter (where m.for_sale),
    count(*) filter (where m.for_sale and m.last_seen_at > (select t from latest) - interval '14 days'),
    count(*) filter (where m.for_sale and cardinality(m.trait_array) > 0),
    count(*) filter (where m.for_sale and m.seller_slug is not null),
    min(m.first_seen_at)::date,
    (select t from latest),
    count(*) filter (where m.sold_at is not null),
    min(m.sold_at)::date,
    max(m.sold_at)::date,
    (select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'n', w.n) order by w.week), '[]'::jsonb)
       from (select date_trunc('week', x.last_seen_at)::date as week, count(*) as n
             from m x where x.for_sale group by 1) w)
  from m;
$$;

grant execute on function geck_data.data_health() to anon, authenticated;
