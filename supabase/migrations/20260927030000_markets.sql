-- Crested gecko markets side by side: US, South Korea, Europe, Canada, UK.
--
-- Sources, all asking prices:
--   US  MorphMarket listings in USD
--   KR  Feedle (native KRW) and Korean Cafe24 breeder shops
--   EU  terraristik.com classifieds and MorphMarket listings in EUR
--   CA  MorphMarket listings in CAD
--   UK  MorphMarket listings in GBP
-- US breeder shops (TikisGeckos, Altitude) are kept as their own source
-- and left out of the US market figure: they are a handful of high-end
-- sellers, not the market.
--
-- Everything converts to USD at the latest stored rate (fx_rates, written
-- daily by scrape_cross_platform.py). Using one rate for all dates keeps
-- trends about local prices, not currency swings.

create table if not exists geck_data.fx_rates (
  currency text primary key,
  per_usd numeric not null check (per_usd > 0),
  as_of timestamptz not null default now(),
  source text
);
alter table geck_data.fx_rates enable row level security;
drop policy if exists "public read fx_rates" on geck_data.fx_rates;
create policy "public read fx_rates" on geck_data.fx_rates for select to anon, authenticated using (true);
grant select on geck_data.fx_rates to anon, authenticated;

-- Seed so the page works before the first scraper run replaces these.
insert into geck_data.fx_rates (currency, per_usd, as_of, source) values
  ('USD', 1, '2026-09-22', 'identity'),
  ('KRW', 1355.05, '2026-09-25', 'seed: frankfurter via scraper log'),
  ('EUR', 0.8765, '2026-09-22', 'seed'),
  ('GBP', 0.75404, '2026-09-22', 'seed'),
  ('CAD', 1.40665, '2026-09-22', 'seed')
on conflict (currency) do nothing;

-- One price per listing per day, from each scraper run.
create table if not exists geck_data.cross_platform_observations (
  platform text not null,
  external_id text not null,
  observed_on date not null,
  price numeric,
  currency text,
  sold boolean not null default false,
  primary key (platform, external_id, observed_on)
);
alter table geck_data.cross_platform_observations enable row level security;
drop policy if exists "public read cross_platform_observations" on geck_data.cross_platform_observations;
create policy "public read cross_platform_observations" on geck_data.cross_platform_observations
  for select to anon, authenticated using (true);
grant select on geck_data.cross_platform_observations to anon, authenticated;

-- Start the history with each listing's last known price.
insert into geck_data.cross_platform_observations (platform, external_id, observed_on, price, currency, sold)
select c.platform, c.external_id, c.last_seen_at::date, c.price, c.currency,
  coalesce((c.payload->>'sold')::boolean, false)
from geck_data.cross_platform_listings c
where c.platform <> 'feedle_air' and c.last_seen_at is not null
on conflict do nothing;

-- Names other markets use that the morph list does not: Feedle shorthand
-- and Korean shop names. traits is what each alias means.
create table if not exists geck_data.market_trait_alias (
  alias text primary key,
  traits text[] not null
);
alter table geck_data.market_trait_alias enable row level security;
drop policy if exists "public read market_trait_alias" on geck_data.market_trait_alias;
create policy "public read market_trait_alias" on geck_data.market_trait_alias for select to anon, authenticated using (true);
grant select on geck_data.market_trait_alias to anon, authenticated;

insert into geck_data.market_trait_alias (alias, traits) values
  ('tri', '{Tri-color}'),
  ('quad', '{Quad-stripe}'),
  ('lw', '{Lilly White}'),
  ('lw sable', '{Lilly White,Sable}'),
  ('lilly axanthic', '{Lilly White,Axanthic}'),
  ('lilly 100% het axanthic', '{Lilly White,Het Axanthic}'),
  ('100% het axanthic', '{Het Axanthic}'),
  ('white porthole', '{Portholes}'),
  ('릴리화이트', '{Lilly White}'),
  ('릴리 화이트', '{Lilly White}'),
  ('릴리', '{Lilly White}'),
  ('엑잔틱', '{Axanthic}'),
  ('액잔틱', '{Axanthic}'),
  ('악잔틱', '{Axanthic}'),
  ('익스트림 할리퀸', '{Extreme Harlequin}'),
  ('익스트림할리퀸', '{Extreme Harlequin}'),
  ('익할', '{Extreme Harlequin}'),
  ('할리퀸', '{Harlequin}'),
  ('슈퍼 달마시안', '{Super Dalmatian}'),
  ('슈퍼달마시안', '{Super Dalmatian}'),
  ('슈달', '{Super Dalmatian}'),
  ('달마시안', '{Dalmatian}'),
  ('풀핀', '{Full Pinstripe}'),
  ('풀 핀스트라이프', '{Full Pinstripe}'),
  ('풀핀스트라이프', '{Full Pinstripe}'),
  ('핀스트라이프', '{Pinstripe}'),
  ('트라이컬러', '{Tri-color}'),
  ('트라이 컬러', '{Tri-color}'),
  ('카푸치노', '{Cappuccino}'),
  ('프라푸치노', '{Frappuccino}'),
  ('세이블', '{Sable}'),
  ('팬텀', '{Phantom}'),
  ('탄제린', '{Tangerine}'),
  ('크림시클', '{}'),
  ('크림', '{Cream}'),
  ('레드', '{Red}'),
  ('옐로우', '{Yellow}'),
  ('옐로', '{Yellow}'),
  ('오렌지', '{Orange}'),
  ('다크', '{Dark}'),
  ('드리피', '{Drippy}'),
  ('쿼드', '{Quad-stripe}'),
  ('화이트월', '{White Wall}'),
  ('엠티백', '{Empty Back}'),
  ('엠티 백', '{Empty Back}'),
  ('하이포', '{Hypo}'),
  ('소프트스케일', '{Soft Scale}'),
  ('포트홀', '{Portholes}'),
  ('브린들', '{Brindle}'),
  ('버프', '{Buckskin}')
on conflict (alias) do update set traits = excluded.traits;

-- Drop any morph whose name sits inside another one in the same list, so
-- "Extreme Harlequin" is not also counted as "Harlequin" and "Super
-- Dalmatian" not as "Dalmatian". Applied to every market alike.
create or replace function geck_data._drop_contained(p_traits text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct a order by a), '{}')
  from unnest(p_traits) a
  where not exists (
    select 1 from unnest(p_traits) b
    where b <> a and position(lower(a) in lower(b)) > 0
  );
$$;

-- Canonical morphs named in free text (a title, Feedle's trait list, a
-- Korean shop product name). English names match on word boundaries;
-- Korean names match anywhere, since shops run words together. A name
-- inside a longer matched name is dropped (Harlequin inside Extreme
-- Harlequin), so an Extreme Harlequin never counts as a plain one.
create or replace function geck_data.match_traits(p_text text)
returns text[]
language sql
stable
as $$
  with t as (select lower(coalesce(p_text, '')) as s),
  names as (
    select m.norm_name as term, array[m.canonical_name] as traits
    from geck_data.crested_morph_taxonomy m
    union all
    select lower(syn), array[m.canonical_name]
    from geck_data.crested_morph_taxonomy m, unnest(m.synonyms) syn
    where length(syn) >= 3
    union all
    select a.alias, a.traits from geck_data.market_trait_alias a
  ),
  hits as (
    select distinct unnest(n.traits) as trait, n.term
    from names n, t
    where case
      when n.term ~ '[가-힣]' then position(n.term in t.s) > 0
      else t.s ~ ('(^|[^a-z0-9])'
        || regexp_replace(n.term, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
        || '($|[^a-z0-9])')
    end
  ),
  -- Aliases that mean "no morph" (크림시클 is a line name, not Cream)
  -- still hide the shorter name they contain.
  blocked as (
    select n.term from names n, t
    where n.traits = '{}' and n.term ~ '[가-힣]' and position(n.term in t.s) > 0
  ),
  kept as (
    select h.trait, h.term from hits h
    where not exists (select 1 from blocked b where position(h.term in b.term) > 0 and b.term <> h.term)
  )
  select geck_data._drop_contained(coalesce(array_agg(distinct k.trait), '{}'))
  from kept k;
$$;

grant execute on function geck_data.match_traits(text) to anon, authenticated;

-- Morph tags for every non-MorphMarket listing, worked out once per
-- refresh instead of on every page load.
create materialized view if not exists geck_data.cross_platform_traits_mv as
select c.platform, c.external_id,
  geck_data.match_traits(coalesce(c.traits_raw, '') || ' , ' || coalesce(c.title, '')) as traits
from geck_data.cross_platform_listings c
where c.platform in ('feedle_kr', 'kr_shops', 'terraristik', 'tikis_geckos', 'altitude_exotics');

create unique index if not exists cross_platform_traits_mv_pk
  on geck_data.cross_platform_traits_mv (platform, external_id);
grant select on geck_data.cross_platform_traits_mv to anon, authenticated;

-- Every current asking price across markets, one row per listing.
create materialized view if not exists geck_data.market_asks_mv as
with names as (
  select m.norm_name as term, m.canonical_name as canon from geck_data.crested_morph_taxonomy m
  union
  select lower(syn), m.canonical_name from geck_data.crested_morph_taxonomy m, unnest(m.synonyms) syn
),
mm as (
  select
    case l.currency when 'USD' then 'US' when 'CAD' then 'CA' when 'EUR' then 'EU' when 'GBP' then 'UK' end as market,
    'morphmarket'::text as source,
    l.listing_id as listing_key,
    l.name as title,
    l.listing_url as url,
    geck_data._drop_contained(coalesce((
      select array_agg(distinct n.canon)
      from unnest(l.trait_array) t(trait)
      join names n on n.term = lower(trim(t.trait))
    ), '{}')) as traits,
    l.sex_class as sex,
    l.price as price_local,
    l.currency,
    l.first_seen_at,
    l.last_seen_at
  from geck_data.listing_market_mv l
  where l.for_sale and not l.is_lot and l.currency in ('USD', 'CAD', 'EUR', 'GBP')
),
cp as (
  select
    case
      when c.platform in ('feedle_kr', 'kr_shops') then 'KR'
      when c.platform = 'terraristik' then 'EU'
      when c.platform in ('tikis_geckos', 'altitude_exotics') then 'US'
    end as market,
    case
      when c.platform = 'feedle_kr' then 'feedle'
      when c.platform in ('tikis_geckos', 'altitude_exotics') then 'us_shops'
      else c.platform
    end as source,
    c.platform || ':' || c.external_id as listing_key,
    c.title,
    c.url,
    coalesce(tr.traits, '{}') as traits,
    case lower(coalesce(c.payload->>'sex', ''))
      when 'male' then 'male' when 'female' then 'female' else 'unsexed'
    end as sex,
    c.price as price_local,
    c.currency,
    c.first_seen_at,
    c.last_seen_at
  from geck_data.cross_platform_listings c
  left join geck_data.cross_platform_traits_mv tr
    on tr.platform = c.platform and tr.external_id = c.external_id
  where c.platform in ('feedle_kr', 'kr_shops', 'terraristik', 'tikis_geckos', 'altitude_exotics')
    and coalesce(c.species, 'crested') = 'crested'
    and not coalesce((c.payload->>'sold')::boolean, false)
    and not coalesce((c.payload->>'is_group_lot')::boolean, false)
    and not coalesce((c.payload->>'exclude_from_combo_arb')::boolean, false)
    and c.price > 0
    -- Listings the source showed within 21 days of its latest run. A run
    -- that reads only part of a catalog (Feedle on Sep 5 and 8) must not
    -- hide the rest; the page shows each market's as-of date.
    and c.last_seen_at >= (
      select max(c2.last_seen_at) - interval '21 days'
      from geck_data.cross_platform_listings c2 where c2.platform = c.platform
    )
),
u as (
  select * from mm
  union all
  select * from cp
)
select u.*,
  round((u.price_local / fx.per_usd)::numeric, 2) as price_usd
from u
join geck_data.fx_rates fx on fx.currency = u.currency
where u.market is not null
  and u.price_local / fx.per_usd between 5 and 100000;

create unique index if not exists market_asks_mv_pk on geck_data.market_asks_mv (source, listing_key);
create index if not exists market_asks_mv_traits on geck_data.market_asks_mv using gin (traits);
grant select on geck_data.market_asks_mv to anon, authenticated;

-- Middle asking prices per market, overall (trait null) and per morph.
-- The US figure is MorphMarket only; US breeder shops come back as their
-- own market, US_SHOPS.
create or replace function geck_data.market_compare(p_min integer default 5)
returns table (
  market text,
  trait text,
  n integer,
  p25 numeric,
  p50 numeric,
  p75 numeric,
  as_of timestamptz
)
language sql
stable
security invoker
as $$
  with a as (
    select case when source = 'us_shops' then 'US_SHOPS' else market end as market,
      traits, price_usd, last_seen_at
    from geck_data.market_asks_mv
  ),
  per as (
    select a.market, t.trait, a.price_usd, a.last_seen_at
    from a, unnest(a.traits) t(trait)
    union all
    select a.market, null, a.price_usd, a.last_seen_at from a
  )
  select p.market, p.trait, count(*)::int,
    round(percentile_cont(0.25) within group (order by p.price_usd)::numeric, 0),
    round(percentile_cont(0.50) within group (order by p.price_usd)::numeric, 0),
    round(percentile_cont(0.75) within group (order by p.price_usd)::numeric, 0),
    max(p.last_seen_at)
  from per p
  group by p.market, p.trait
  having count(*) >= p_min;
$$;
grant execute on function geck_data.market_compare(integer) to anon, authenticated;

-- Weekly middle asking price per market (USD at today's rate). US comes
-- from the MorphMarket weekly history; other markets from daily snapshots,
-- which start with the first run of the updated scraper.
create or replace function geck_data.market_weekly(p_trait text default null)
returns table (market text, week date, n integer, p50 numeric)
language sql
stable
security invoker
as $$
  with us as (
    select 'US'::text as market, w.week, count(*)::int as n,
      round(percentile_cont(0.5) within group (order by w.price)::numeric, 0) as p50
    from geck_data.listing_week_mv w
    where p_trait is null or w.trait_array @> array[p_trait]
    group by w.week
  ),
  obs as (
    select
      case when o.platform in ('feedle_kr', 'kr_shops') then 'KR' when o.platform = 'terraristik' then 'EU' end as market,
      date_trunc('week', o.observed_on)::date as week,
      o.platform, o.external_id,
      (array_agg(o.price / fx.per_usd order by o.observed_on desc))[1] as price_usd
    from geck_data.cross_platform_observations o
    join geck_data.fx_rates fx on fx.currency = o.currency
    join geck_data.cross_platform_listings c
      on c.platform = o.platform and c.external_id = o.external_id
    left join geck_data.cross_platform_traits_mv tr
      on tr.platform = o.platform and tr.external_id = o.external_id
    where o.platform in ('feedle_kr', 'kr_shops', 'terraristik')
      and not o.sold and o.price > 0
      and not coalesce((c.payload->>'is_group_lot')::boolean, false)
      and not coalesce((c.payload->>'exclude_from_combo_arb')::boolean, false)
      and (p_trait is null or tr.traits @> array[p_trait])
    group by 1, 2, 3, 4
  )
  select * from us
  union all
  select o.market, o.week, count(*)::int,
    round(percentile_cont(0.5) within group (order by o.price_usd)::numeric, 0)
  from obs o
  where o.market is not null
  group by o.market, o.week
  order by 1, 2;
$$;
grant execute on function geck_data.market_weekly(text) to anon, authenticated;

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
  refresh materialized view concurrently geck_data.listing_week_mv;
  refresh materialized view concurrently geck_data.cross_platform_traits_mv;
  refresh materialized view concurrently geck_data.market_asks_mv;
$function$;

-- How much more Feedle Air (Feedle's export storefront) asks than the
-- same animal's won price at market exchange rates. About 1.05 in
-- September 2026. Shipping and import fees are extra and not included.
create or replace function geck_data.feedle_import_markup()
returns numeric
language sql
stable
security invoker
as $$
  select round(percentile_cont(0.5) within group (
    order by a.price_usd_equivalent / k.price_usd_equivalent)::numeric, 3)
  from geck_data.cross_platform_listings a
  join geck_data.cross_platform_listings k
    on k.external_id = a.external_id and k.platform = 'feedle_kr'
  where a.platform = 'feedle_air'
    and a.price_usd_equivalent > 0 and k.price_usd_equivalent > 0;
$$;
grant execute on function geck_data.feedle_import_markup() to anon, authenticated;

-- Weekly middle asking price for up to six morphs at once, for the
-- compare view on Trends. partial marks weeks where under half the market
-- was checked; the page leaves those out of the lines.
create or replace function geck_data.compare_trends(p_traits text[])
returns table (trait text, week date, n integer, p50 numeric, partial boolean)
language sql
stable
security invoker
as $$
  with market_weeks as (
    select m.week, count(*) as checked from geck_data.listing_week_mv m group by m.week
  ),
  per as (
    select t.trait, w.week, w.price
    from unnest(p_traits[1:6]) t(trait)
    join geck_data.listing_week_mv w on w.trait_array @> array[t.trait]
  )
  select p.trait, p.week, count(*)::int,
    round(percentile_cont(0.5) within group (order by p.price)::numeric, 0),
    bool_or(mw.checked < 0.5 * (select max(checked) from market_weeks))
  from per p
  join market_weeks mw using (week)
  group by p.trait, p.week
  order by p.trait, p.week;
$$;
grant execute on function geck_data.compare_trends(text[]) to anon, authenticated;

-- The scrapers write with the service role, which new tables do not grant
-- by default. Without these the first run could not store rates or snapshots.
grant select, insert, update, delete on geck_data.fx_rates to service_role;
grant select, insert, update, delete on geck_data.cross_platform_observations to service_role;
grant select, insert, update, delete on geck_data.market_trait_alias to service_role;
