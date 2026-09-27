-- Where each listing's asking price sits among similar geckos.
--
-- Car sites rate a used car "great deal" to "overpriced" against an
-- expected value. Crested gecko prices are far more spread out than car
-- prices (pattern quality, which listings never measure, moves price a
-- lot: the middle 80% of listings runs from 0.36x to 2.3x their expected
-- price), so a "great deal" label would mostly flag lower-grade animals.
-- Instead this reports where a price falls among similar listings: the
-- lowest quarter, the middle half, or the top quarter.
--
-- "Similar listings" for a listing:
--   For each real morph trait on it, the listings with that trait at the
--   same age class and sex (at least 8 of them). If that group is thin,
--   drop sex, then drop age. The trait whose group has the highest middle
--   price is used, because a combo is priced at least at its most valuable
--   trait. A listing with no real traits is compared with all crested
--   geckos of its age and sex, then with all crested geckos.
-- USD only.

-- The age and sex helpers read no tables, so they do not need a pinned
-- search_path. Leaving it off lets Postgres inline them, which takes the
-- per-row cost from about 160ms to near zero across the catalog.
create or replace function geck_data._age_class(p_maturity text)
returns text
language sql
immutable
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
as $$
  select case lower(coalesce(p_sex, ''))
    when 'male' then 'male'
    when 'female' then 'female'
    when 'mixed' then null
    else 'unsexed'
  end;
$$;

drop view if exists geck_data.v_listing_value;

create view geck_data.v_listing_value
with (security_invoker = true)
as
with names as (
  select m.norm_name as norm from geck_data.crested_morph_taxonomy m
  union
  select lower(s) from geck_data.crested_morph_taxonomy m, unnest(m.synonyms) s
),
base as (
  select l.listing_id, l.price, l.trait_array,
    geck_data._age_class(l.maturity) as age_class,
    geck_data._sex_class(l.sex) as sex_class
  from geck_data.listings l
  where coalesce(l.species, 'unknown') in ('crested', 'unknown')
    and l.currency = 'USD' and l.price > 0 and l.price < 100000
),
lt as (
  select b.listing_id, b.price, b.age_class, b.sex_class, t.trait
  from base b, unnest(b.trait_array) t(trait)
  where lower(trim(t.trait)) in (select norm from names)
    and t.trait not ilike 'Diet:%' and t.trait not ilike 'Proven breeder%'
),
trait_stats as (
  select lt.trait,
    case when grouping(lt.age_class) = 1 then 'any' else lt.age_class end as age_class,
    case when grouping(lt.sex_class) = 1 then 'any' else lt.sex_class end as sex_class,
    count(*) as n,
    percentile_cont(0.25) within group (order by lt.price) as p25,
    percentile_cont(0.50) within group (order by lt.price) as p50,
    percentile_cont(0.75) within group (order by lt.price) as p75
  from lt
  group by grouping sets ((lt.trait, lt.age_class, lt.sex_class), (lt.trait, lt.age_class), (lt.trait))
),
market_stats as (
  select
    case when grouping(b.age_class) = 1 then 'any' else b.age_class end as age_class,
    case when grouping(b.sex_class) = 1 then 'any' else b.sex_class end as sex_class,
    count(*) as n,
    percentile_cont(0.25) within group (order by b.price) as p25,
    percentile_cont(0.50) within group (order by b.price) as p50,
    percentile_cont(0.75) within group (order by b.price) as p75
  from base b
  group by grouping sets ((b.age_class, b.sex_class), ())
),
per_trait as (
  select lt.listing_id, lt.trait,
    case
      when s1.trait is not null then 'trait_age_sex'
      when s2.trait is not null then 'trait_age'
      when s3.trait is not null then 'trait'
    end as basis,
    coalesce(s1.n, s2.n, s3.n) as n,
    coalesce(s1.p25, s2.p25, s3.p25) as p25,
    coalesce(s1.p50, s2.p50, s3.p50) as p50,
    coalesce(s1.p75, s2.p75, s3.p75) as p75
  from lt
  left join trait_stats s1
    on s1.trait = lt.trait and s1.age_class = lt.age_class and s1.sex_class = lt.sex_class and s1.n >= 8
  left join trait_stats s2
    on s2.trait = lt.trait and s2.age_class = lt.age_class and s2.sex_class = 'any' and s2.n >= 8
  left join trait_stats s3
    on s3.trait = lt.trait and s3.age_class = 'any' and s3.sex_class = 'any' and s3.n >= 8
),
best as (
  select distinct on (p.listing_id) p.*
  from per_trait p
  where p.p50 is not null
  order by p.listing_id, p.p50 desc
),
ref as (
  select b.listing_id, b.price, b.age_class, b.sex_class,
    best.trait,
    case
      when best.p50 is not null then best.basis
      when m1.p50 is not null then 'market_age_sex'
      else 'market'
    end as basis,
    coalesce(best.n, m1.n, m2.n) as n,
    coalesce(best.p25, m1.p25, m2.p25) as p25,
    coalesce(best.p50, m1.p50, m2.p50) as p50,
    coalesce(best.p75, m1.p75, m2.p75) as p75
  from base b
  left join best on best.listing_id = b.listing_id
  left join market_stats m1
    on m1.age_class = b.age_class and m1.sex_class = b.sex_class and m1.n >= 8
  cross join (
    select n, p25, p50, p75 from market_stats where age_class = 'any' and sex_class = 'any'
  ) m2
)
select r.listing_id,
  r.age_class,
  r.sex_class,
  r.trait as compared_trait,
  r.basis,
  r.n as compared_n,
  round(r.p25::numeric, 0) as similar_p25,
  round(r.p50::numeric, 0) as similar_p50,
  round(r.p75::numeric, 0) as similar_p75,
  round((r.price / nullif(r.p50, 0))::numeric, 2) as ratio,
  case
    when r.price < r.p25 then 'low'
    when r.price > r.p75 then 'high'
    else 'typical'
  end as position
from ref r;

grant select on geck_data.v_listing_value to anon, authenticated;

-- Precomputed per-listing market view the site reads directly: listing
-- details, where the price sits among similar geckos, and any price cut
-- since the listing was first seen. Refreshed hourly with the other market
-- views (refresh_market_matviews, scheduled in pg_cron), which matches how
-- often the catalog itself changes.
create materialized view if not exists geck_data.listing_market_mv as
with first_price as (
  select distinct on (h.listing_id) h.listing_id, h.price as first_price, h.observed_at as first_observed_at
  from geck_data.price_history h
  where h.price is not null and h.price > 0
  order by h.listing_id, h.observed_at asc
)
select l.listing_id, l.name, l.price, l.currency, l.sex, l.maturity, l.trait_array,
  l.primary_image_url, l.listing_url, l.seller_slug, l.seller_name, l.weight_grams,
  l.first_seen_at, l.last_seen_at, l.sold_at, l.is_active, l.species,
  (l.is_active and l.sold_at is null) as for_sale,
  v.age_class, v.sex_class, v.compared_trait, v.basis, v.compared_n,
  v.similar_p25, v.similar_p50, v.similar_p75, v.ratio, v.position,
  case when fp.first_price > l.price then round(fp.first_price - l.price, 0) end as price_cut,
  fp.first_price
from geck_data.listings l
left join geck_data.v_listing_value v on v.listing_id = l.listing_id
left join first_price fp on fp.listing_id = l.listing_id
where coalesce(l.species, 'unknown') in ('crested', 'unknown')
  and l.price > 0 and l.price < 100000;

create unique index if not exists listing_market_mv_pk on geck_data.listing_market_mv (listing_id);
create index if not exists listing_market_mv_traits on geck_data.listing_market_mv using gin (trait_array);
create index if not exists listing_market_mv_seller on geck_data.listing_market_mv (seller_slug);

grant select on geck_data.listing_market_mv to anon, authenticated;

create or replace function geck_data.refresh_market_matviews()
returns void
language sql
security definer
set search_path to 'pg_catalog', 'geck_data', 'extensions'
as $function$
  refresh materialized view concurrently geck_data.v_observed_traits;
  refresh materialized view concurrently geck_data.combo_weekly_prices_mv;
  refresh materialized view concurrently geck_data.v_sold_reconciled;
  refresh materialized view concurrently geck_data.listing_market_mv;
$function$;
