-- Market history: how asking prices, new listings and price changes moved
-- week by week, overall or for one morph, plus one listing's own price
-- history.
--
-- price_history stores canonical ids ("mm_123") while listings uses the
-- bare MorphMarket id ("123"). The old first_price join in
-- listing_market_mv compared them directly and never matched, so
-- price_cut was always empty. The view is rebuilt with the prefix
-- stripped, and breeder_market_v (which depends on it) is recreated
-- unchanged.
--
-- Weeks with no scrape are simply absent from market_trend: the page
-- draws them as gaps, never as zero. after_gap marks a week whose
-- previous week was not tracked, so its "new" and "came down" counts
-- would span the whole gap and are returned as null. partial marks a
-- week where fewer than half as many listings were checked as in the
-- busiest week (a smoke run or a partial recheck), so its middle price
-- is a small sample. New and came-down counts also need the week before
-- to have been a full check, otherwise the first full week would count
-- the whole backfilled catalog as "new".

drop function if exists geck_data.market_trend(text);

create or replace function geck_data.market_trend(p_trait text default null)
returns table (
  week date,
  seen integer,
  p25 numeric,
  p50 numeric,
  p75 numeric,
  cuts integer,
  raises integer,
  median_cut numeric,
  new_listings integer,
  came_down integer,
  after_gap boolean,
  partial boolean
)
language sql
stable
security invoker
as $$
  with l as (
    select l.listing_id, l.first_seen_at, l.sold_at
    from geck_data.listings l
    where coalesce(l.species, 'unknown') in ('crested', 'unknown')
      and not geck_data._looks_like_group_lot(l.name, false)
      and (p_trait is null or l.trait_array @> array[p_trait])
  ),
  obs as (
    select regexp_replace(h.listing_id, '^mm_', '') as listing_id, h.observed_at, h.price
    from geck_data.price_history h
    where h.currency = 'USD' and h.price > 0 and h.price < 100000
  ),
  o as (
    select o.*, lag(o.price) over (partition by o.listing_id order by o.observed_at) as prev
    from obs o
    join l using (listing_id)
  ),
  per_listing as (
    select date_trunc('week', o.observed_at)::date as week, o.listing_id,
      (array_agg(o.price order by o.observed_at desc))[1] as price,
      bool_or(o.prev is not null and o.price < o.prev) as cut,
      bool_or(o.prev is not null and o.price > o.prev) as raised,
      min(case when o.prev is not null and o.price < o.prev then (o.prev - o.price) / o.prev end) as cut_pct
    from o
    group by 1, 2
  ),
  weeks as (
    select p.week,
      count(*)::int as seen,
      round(percentile_cont(0.25) within group (order by p.price)::numeric, 0) as p25,
      round(percentile_cont(0.50) within group (order by p.price)::numeric, 0) as p50,
      round(percentile_cont(0.75) within group (order by p.price)::numeric, 0) as p75,
      count(*) filter (where p.cut)::int as cuts,
      count(*) filter (where p.raised)::int as raises,
      round((percentile_cont(0.5) within group (order by p.cut_pct) filter (where p.cut))::numeric, 2) as median_cut
    from per_listing p
    group by p.week
  ),
  -- Partial is judged on the whole market's check that week, so a rare
  -- morph's small counts never read as a partial scrape.
  market_weeks as (
    select date_trunc('week', obs.observed_at)::date as week,
      count(distinct obs.listing_id) as checked
    from obs
    group by 1
  ),
  sized as (
    select w.*, m.checked < 0.5 * (select max(checked) from market_weeks) as partial
    from weeks w
    join market_weeks m using (week)
  ),
  flagged as (
    select w.*,
      coalesce(lag(w.week) over (order by w.week) <> w.week - 7, true) as after_gap,
      coalesce(lag(w.partial) over (order by w.week), true) as prev_partial
    from sized w
  )
  select f.week, f.seen, f.p25, f.p50, f.p75, f.cuts, f.raises, f.median_cut,
    case when f.after_gap or f.partial or f.prev_partial then null else
      (select count(*)::int from l where date_trunc('week', l.first_seen_at)::date = f.week) end,
    case when f.after_gap or f.partial or f.prev_partial then null else
      (select count(*)::int from l where date_trunc('week', l.sold_at)::date = f.week) end,
    f.after_gap,
    f.partial
  from flagged f
  order by f.week;
$$;

grant execute on function geck_data.market_trend(text) to anon, authenticated;

create or replace function geck_data.listing_price_history(p_listing_id text)
returns table (observed_at timestamptz, price numeric, currency text)
language sql
stable
security invoker
as $$
  select h.observed_at, h.price, h.currency
  from geck_data.price_history h
  where h.listing_id in (p_listing_id, 'mm_' || p_listing_id)
    and h.price > 0
  order by h.observed_at;
$$;

grant execute on function geck_data.listing_price_history(text) to anon, authenticated;

drop materialized view if exists geck_data.listing_market_mv cascade;

create materialized view if not exists geck_data.listing_market_mv as
with first_price as (
  select distinct on (regexp_replace(h.listing_id, '^mm_', ''))
    regexp_replace(h.listing_id, '^mm_', '') as listing_id,
    h.price as first_price, h.currency as first_currency, h.observed_at as first_observed_at
  from geck_data.price_history h
  where h.price is not null and h.price > 0
  order by regexp_replace(h.listing_id, '^mm_', ''), h.observed_at asc
)
select l.listing_id, l.name, l.price, l.currency, l.sex, l.maturity, l.trait_array,
  l.primary_image_url, l.listing_url, l.seller_slug, l.seller_name, l.weight_grams,
  l.first_seen_at, l.last_seen_at, l.sold_at, l.is_active, l.species,
  (l.is_active and l.sold_at is null) as for_sale,
  geck_data._looks_like_group_lot(l.name, false) as is_lot,
  v.age_class, v.sex_class, v.compared_trait, v.basis, v.compared_n,
  v.similar_p25, v.similar_p50, v.similar_p75, v.ratio, v.position,
  case when fp.first_price > l.price then round(fp.first_price - l.price, 0) end as price_cut,
  fp.first_price
from geck_data.listings l
left join geck_data.v_listing_value v on v.listing_id = l.listing_id
left join first_price fp
  on fp.listing_id = l.listing_id and fp.first_currency is not distinct from l.currency
where coalesce(l.species, 'unknown') in ('crested', 'unknown')
  and l.price > 0 and l.price < 100000;

create unique index if not exists listing_market_mv_pk on geck_data.listing_market_mv (listing_id);
create index if not exists listing_market_mv_traits on geck_data.listing_market_mv using gin (trait_array);
create index if not exists listing_market_mv_seller on geck_data.listing_market_mv (seller_slug);

grant select on geck_data.listing_market_mv to anon, authenticated;


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

