-- Read-only helpers for the simplified site (Price check, Morphs, Listings).
--
-- morph_summary(): one row per real crested gecko trait (seller
-- questionnaire noise like "Diet: Meal Replacement" is dropped through
-- is_training_trait), with how many are for sale now, the asking price
-- band, and how many sold with their median price.
--
-- asking_price_band(traits): the asking price band for active listings
-- that carry every trait in the set. The price check shows this next to
-- the sold band, because the sold history is older than the catalog.
--
-- Both read geck_data.listings, crested and unclassified rows only, USD
-- prices only (about 98% of rows). "For sale" means active and not marked
-- sold. Nothing here writes.

create or replace function geck_data.morph_summary()
returns table (
  trait text,
  for_sale bigint,
  ask_p25 numeric,
  ask_p50 numeric,
  ask_p75 numeric,
  sold bigint,
  sold_p50 numeric,
  last_seen_at timestamptz
)
language sql
stable
set search_path to ''
as $$
  with rows as (
    select
      unnest(l.trait_array) as trait,
      l.price,
      l.currency,
      (l.is_active and l.sold_at is null) as is_active,
      l.sold_at,
      l.last_seen_at
    from geck_data.listings l
    where coalesce(l.species, 'unknown') in ('crested', 'unknown')
      and l.price > 0
      and l.price < 100000
  ),
  real_traits as (
    select d.trait
    from (select distinct r.trait from rows r) d
    where geck_data.is_training_trait(d.trait)
  )
  select
    r.trait,
    count(*) filter (where r.is_active),
    round(percentile_cont(0.25) within group (order by r.price)
      filter (where r.is_active and r.currency = 'USD')::numeric, 0),
    round(percentile_cont(0.50) within group (order by r.price)
      filter (where r.is_active and r.currency = 'USD')::numeric, 0),
    round(percentile_cont(0.75) within group (order by r.price)
      filter (where r.is_active and r.currency = 'USD')::numeric, 0),
    count(*) filter (where r.sold_at is not null),
    round(percentile_cont(0.50) within group (order by r.price)
      filter (where r.sold_at is not null and r.currency = 'USD')::numeric, 0),
    max(r.last_seen_at)
  from rows r
  join real_traits t on t.trait = r.trait
  group by r.trait
  order by 2 desc, 1;
$$;

create or replace function geck_data.asking_price_band(p_traits text[])
returns table (
  n bigint,
  p10 numeric,
  p25 numeric,
  p50 numeric,
  p75 numeric,
  p90 numeric,
  n_sellers bigint,
  newest_seen_at timestamptz
)
language sql
stable
set search_path to ''
as $$
  select
    count(*),
    round(percentile_cont(0.10) within group (order by l.price)::numeric, 0),
    round(percentile_cont(0.25) within group (order by l.price)::numeric, 0),
    round(percentile_cont(0.50) within group (order by l.price)::numeric, 0),
    round(percentile_cont(0.75) within group (order by l.price)::numeric, 0),
    round(percentile_cont(0.90) within group (order by l.price)::numeric, 0),
    count(distinct l.seller_slug),
    max(l.last_seen_at)
  from geck_data.listings l
  where l.is_active and l.sold_at is null
    and coalesce(l.species, 'unknown') in ('crested', 'unknown')
    and l.currency = 'USD'
    and l.price > 0
    and l.price < 100000
    and l.trait_array @> coalesce(p_traits, '{}'::text[]);
$$;

grant execute on function geck_data.morph_summary() to anon, authenticated;
grant execute on function geck_data.asking_price_band(text[]) to anon, authenticated;

-- breeder_summary(): one row per seller slug with listings for sale, their
-- median asking price, how many sold, and the three morphs they list most.
create or replace function geck_data.breeder_summary()
returns table (
  seller_slug text,
  name text,
  location text,
  avatar_url text,
  for_sale bigint,
  ask_p50 numeric,
  sold bigint,
  top_traits text[],
  last_seen_at timestamptz
)
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
    select b.seller_slug,
      max(b.seller_name) as seller_name,
      count(*) filter (where b.for_sale_now) as for_sale,
      round(percentile_cont(0.5) within group (order by b.price)
        filter (where b.for_sale_now and b.currency = 'USD')::numeric, 0) as ask_p50,
      count(*) filter (where b.sold_at is not null) as sold,
      max(b.last_seen_at) as last_seen_at
    from base b
    group by b.seller_slug
  ),
  traits as (
    select b.seller_slug, t.trait, count(*) as n
    from base b, unnest(b.trait_array) t(trait)
    where b.for_sale_now
    group by 1, 2
  ),
  real_traits as (
    select d.trait
    from (select distinct trait from traits) d
    where geck_data.is_training_trait(d.trait)
  ),
  ranked as (
    select tr.seller_slug, tr.trait,
      row_number() over (partition by tr.seller_slug order by tr.n desc, tr.trait) as rk
    from traits tr
    join real_traits rt on rt.trait = tr.trait
  )
  select a.seller_slug,
    coalesce(nullif(s.store_name, ''), a.seller_name, a.seller_slug),
    s.location_raw,
    s.avatar_url,
    a.for_sale,
    a.ask_p50,
    a.sold,
    coalesce((select array_agg(r.trait order by r.rk) from ranked r
              where r.seller_slug = a.seller_slug and r.rk <= 3), '{}'),
    a.last_seen_at
  from agg a
  left join geck_data.sellers s on s.seller_slug = a.seller_slug
  order by a.for_sale desc, a.sold desc;
$$;

grant execute on function geck_data.breeder_summary() to anon, authenticated;

-- morph_summary and breeder_summary run as the caller and call
-- is_training_trait, so public visitors need execute on it too.
grant execute on function geck_data.is_training_trait(text) to anon, authenticated;
