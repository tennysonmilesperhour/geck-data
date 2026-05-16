-- ============================================================================
-- 0019_v_combo_profitability.sql
--
-- Combo profitability ranking: surface the most likely-revenue combos based
-- on a blend of price and sell-through. Powers the /trends profitability
-- tiers section.
--
-- Score formula (per the design call):
--
--   effective_price   = median_sold (when ≥1 sold event) else median_ask * 0.8
--   sell_through_rate = sold_count / (sold_count + live_count)
--   score             = effective_price * sell_through_rate
--
-- Sell-through replaces the avg_days_to_sell signal because the existing
-- listing_status_events bootstrap stamped pre-existing sold rows with
-- days_since_first_seen = 0, which made days_to_sell unreliable. Once the
-- catalog has been running long enough that days_to_sell reflects real
-- first_seen → sold spans, a follow-up can swap that in (or blend it).
--
-- Universe is anchor combos (combo_catalog) UNION auto-discovered trait
-- pairs that pass a minimum-sample threshold. Anchors keep their curated
-- display names. Pairs are formed across the top-frequency trait tokens
-- only, so we don't fan out into thousands of low-N pairs.
--
-- The function returns RAW SCORE; tier bucketing happens in TypeScript so
-- the UI can change tier cutoffs without a migration.
-- ============================================================================

create or replace function public.v_combo_profitability(
  p_window_days        int default 90,
  p_min_top_trait_n    int default 25,
  p_min_pair_listings  int default 20
)
returns table (
  combo_name        text,
  combo_source      text,    -- 'anchor' | 'discovered'
  sold_count        int,
  live_count        int,
  median_sold       numeric,
  median_ask        numeric,
  sell_through_rate numeric,
  effective_price   numeric,
  score             numeric,
  confidence        int
)
language sql
stable
parallel safe
set search_path = public
as $body$
with
-- Tokenize each listing's traits using the same rules as the JS
-- parseTraitList (drop tokens with ':' or shorter than 3 chars).
listing_tokens as (
  select
    l.id,
    l.price_usd_equivalent,
    l.current_status,
    lower(trim(both ' ' from tok)) as token
  from public.market_listings l,
       lateral regexp_split_to_table(
         coalesce(l.cached_traits, replace(coalesce(l.norm_traits, ''), ',', '|')),
         '\s*[|,]\s*'
       ) as tok
  where l.price_usd_equivalent is not null
    and l.price_usd_equivalent between 50 and 10000
    and tok is not null
    and lower(trim(both ' ' from tok)) <> ''
    and length(trim(both ' ' from tok)) >= 3
    and position(':' in tok) = 0
),
-- Sold-status events within the window. v_combo_rollups uses the same
-- shape; we replicate locally so this function doesn't depend on it.
sold_events as (
  select distinct lse.listing_id
  from public.listing_status_events lse
  where lse.status = 'sold'
    and lse.observed_at >= now() - make_interval(days => p_window_days)
),
-- Listings that were first seen within the window — gates the "live"
-- side to the same period so the ratio is window-consistent.
in_window_listings as (
  select id from public.market_listings
  where first_seen_at >= now() - make_interval(days => p_window_days)
),
-- ---- Anchor combos ----
anchor_classified as (
  select
    c.combo_name,
    'anchor'::text as combo_source,
    l.id,
    l.price_usd_equivalent,
    case when se.listing_id is not null then 'sold' else l.current_status end as effective_status
  from public.combo_catalog c
  cross join lateral (
    select id, price_usd_equivalent, current_status, cached_traits, norm_traits
    from public.market_listings
    where price_usd_equivalent is not null
      and price_usd_equivalent between 50 and 10000
      and (
        select bool_and(
          position(token in lower(coalesce(cached_traits, '') || ' ' || coalesce(norm_traits, ''))) > 0
        )
        from unnest(c.tokens) as token
      )
  ) l
  left join sold_events se on se.listing_id = l.id
  where l.id in (select id from in_window_listings)
     or se.listing_id is not null
),
anchor_rollup as (
  select
    combo_name,
    combo_source,
    count(*) filter (where effective_status = 'sold')::int as sold_count,
    count(*) filter (where effective_status = 'live')::int as live_count,
    percentile_cont(0.5) within group (order by price_usd_equivalent)
      filter (where effective_status = 'sold') as median_sold,
    percentile_cont(0.5) within group (order by price_usd_equivalent)
      filter (where effective_status = 'live') as median_ask
  from anchor_classified
  group by combo_name, combo_source
),
-- ---- Auto-discovered pair combos ----
top_traits as (
  select token, count(*) as n
  from listing_tokens
  group by token
  having count(*) >= p_min_top_trait_n
),
listing_pairs as (
  select
    t1.id,
    t1.price_usd_equivalent,
    case when se.listing_id is not null then 'sold' else t1.current_status end as effective_status,
    initcap(t1.token) || ' × ' || initcap(t2.token) as combo_name
  from listing_tokens t1
  join listing_tokens t2 on t1.id = t2.id and t1.token < t2.token
  join top_traits ta on ta.token = t1.token
  join top_traits tb on tb.token = t2.token
  left join sold_events se on se.listing_id = t1.id
  where t1.id in (select id from in_window_listings)
     or se.listing_id is not null
),
pair_rollup as (
  select
    combo_name,
    'discovered'::text as combo_source,
    count(*) filter (where effective_status = 'sold')::int as sold_count,
    count(*) filter (where effective_status = 'live')::int as live_count,
    percentile_cont(0.5) within group (order by price_usd_equivalent)
      filter (where effective_status = 'sold') as median_sold,
    percentile_cont(0.5) within group (order by price_usd_equivalent)
      filter (where effective_status = 'live') as median_ask
  from listing_pairs
  group by combo_name
  having count(*) >= p_min_pair_listings
),
-- ---- Union, drop duplicates (anchor display names win over auto-discovered
-- pair names that happen to surface the same two tokens) ----
combined as (
  select * from anchor_rollup
  union all
  select * from pair_rollup
  where combo_name not in (select combo_name from anchor_rollup)
)
select
  c.combo_name,
  c.combo_source,
  c.sold_count,
  c.live_count,
  round(c.median_sold::numeric, 0)              as median_sold,
  round(c.median_ask::numeric, 0)               as median_ask,
  round(
    (case when (c.sold_count + c.live_count) = 0 then 0
          else c.sold_count::numeric / (c.sold_count + c.live_count)
     end)::numeric,
    4
  ) as sell_through_rate,
  -- effective price: sold median when we have it, otherwise 80% of ask
  -- (typical haircut from sticker to clearing price).
  round(
    (coalesce(c.median_sold, c.median_ask * 0.8))::numeric,
    0
  ) as effective_price,
  round(
    (coalesce(c.median_sold, c.median_ask * 0.8)
     * (case when (c.sold_count + c.live_count) = 0 then 0
             else c.sold_count::numeric / (c.sold_count + c.live_count)
        end)
    )::numeric,
    2
  ) as score,
  -- Confidence: linear in sample size, capped at 99. Same shape as
  -- v_combo_rollups so the UI can use a shared scale.
  least(99,
    greatest(1,
      round((10 + c.sold_count * 4 + c.live_count * 0.4)::numeric)
    )
  )::int as confidence
from combined c
where (c.sold_count + c.live_count) > 0;
$body$;

grant execute on function public.v_combo_profitability(int, int, int) to anon, authenticated;
