-- Japan joins the markets, and Japanese morph names are recognised.
--
-- Japan comes from Repsuki (repsuki.com), a reptile search site that lists
-- stock from Japanese shops: 182 crested geckos from 25 shops when first
-- read in September 2026. Prices are in yen; the stored JPY rate converts
-- them. Scraping the shops one by one as well would count the same animals
-- twice, so Repsuki is the only Japanese source.
--
-- match_traits now treats katakana names like Korean ones (matched
-- anywhere in the text), and market_trait_alias gains the katakana morph
-- names shops use. クリームシクル (Creamsicle) is a line name and is
-- blocked from matching Cream, as 크림시클 is.

insert into geck_data.market_trait_alias (alias, traits) values
  ('リリーホワイト', '{Lilly White}'),
  ('リリー', '{Lilly White}'),
  ('エクストリームハーレクイン', '{Extreme Harlequin}'),
  ('エクストリーム ハーレクイン', '{Extreme Harlequin}'),
  ('ハーレクイン', '{Harlequin}'),
  ('スーパーダルメシアン', '{Super Dalmatian}'),
  ('ダルメシアン', '{Dalmatian}'),
  ('フルピンストライプ', '{Full Pinstripe}'),
  ('フルピン', '{Full Pinstripe}'),
  ('パーシャルピンストライプ', '{Partial Pinstripe}'),
  ('ピンストライプ', '{Pinstripe}'),
  ('トリカラー', '{Tri-color}'),
  ('トライカラー', '{Tri-color}'),
  ('カプチーノ', '{Cappuccino}'),
  ('フラペチーノ', '{Frappuccino}'),
  ('フラペ', '{Frappuccino}'),
  ('セーブル', '{Sable}'),
  ('アザンティック', '{Axanthic}'),
  ('アクサンティック', '{Axanthic}'),
  ('ファントム', '{Phantom}'),
  ('タンジェリン', '{Tangerine}'),
  ('クリームシクル', '{}'),
  ('クリーム', '{Cream}'),
  ('レッド', '{Red}'),
  ('イエロー', '{Yellow}'),
  ('オレンジ', '{Orange}'),
  ('ダーク', '{Dark}'),
  ('ドリッピー', '{Drippy}'),
  ('クアッドストライプ', '{Quad-stripe}'),
  ('クワッドストライプ', '{Quad-stripe}'),
  ('ホワイトウォール', '{White Wall}'),
  ('エンプティーバック', '{Empty Back}'),
  ('エンプティバック', '{Empty Back}'),
  ('ハイポ', '{Hypo}'),
  ('ソフトスケール', '{Soft Scale}'),
  ('ポートホール', '{Portholes}'),
  ('ブリンドル', '{Brindle}'),
  ('ラベンダー', '{Lavender}'),
  ('パターンレス', '{Patternless}'),
  ('タイガー', '{Tiger}'),
  ('バックスキン', '{Buckskin}')
on conflict (alias) do update set traits = excluded.traits;

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
      when n.term ~ '[가-힣ぁ-んァ-ヶ]' then position(n.term in t.s) > 0
      else t.s ~ ('(^|[^a-z0-9])'
        || regexp_replace(n.term, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
        || '($|[^a-z0-9])')
    end
  ),
  -- Aliases that mean "no morph" (크림시클 is a line name, not Cream)
  -- still hide the shorter name they contain.
  blocked as (
    select n.term from names n, t
    where n.traits = '{}' and n.term ~ '[가-힣ぁ-んァ-ヶ]' and position(n.term in t.s) > 0
  ),
  kept as (
    select h.trait, h.term from hits h
    where not exists (select 1 from blocked b where position(h.term in b.term) > 0 and b.term <> h.term)
  )
  select geck_data._drop_contained(coalesce(array_agg(distinct k.trait), '{}'))
  from kept k;
$$;

drop materialized view if exists geck_data.market_asks_mv;
drop materialized view if exists geck_data.cross_platform_traits_mv;

create materialized view if not exists geck_data.cross_platform_traits_mv as
select c.platform, c.external_id,
  geck_data.match_traits(coalesce(c.traits_raw, '') || ' , ' || coalesce(c.title, '')) as traits
from geck_data.cross_platform_listings c
where c.platform in ('feedle_kr', 'kr_shops', 'terraristik', 'tikis_geckos', 'altitude_exotics', 'repsuki');

create unique index if not exists cross_platform_traits_mv_pk
  on geck_data.cross_platform_traits_mv (platform, external_id);
grant select on geck_data.cross_platform_traits_mv to anon, authenticated;

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
      when c.platform = 'repsuki' then 'JP'
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
  where c.platform in ('feedle_kr', 'kr_shops', 'terraristik', 'tikis_geckos', 'altitude_exotics', 'repsuki')
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
      case when o.platform in ('feedle_kr', 'kr_shops') then 'KR' when o.platform = 'terraristik' then 'EU' when o.platform = 'repsuki' then 'JP' end as market,
      date_trunc('week', o.observed_on)::date as week,
      o.platform, o.external_id,
      (array_agg(o.price / fx.per_usd order by o.observed_on desc))[1] as price_usd
    from geck_data.cross_platform_observations o
    join geck_data.fx_rates fx on fx.currency = o.currency
    join geck_data.cross_platform_listings c
      on c.platform = o.platform and c.external_id = o.external_id
    left join geck_data.cross_platform_traits_mv tr
      on tr.platform = o.platform and tr.external_id = o.external_id
    where o.platform in ('feedle_kr', 'kr_shops', 'terraristik', 'repsuki')
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
