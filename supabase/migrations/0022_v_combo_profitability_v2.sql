-- ============================================================================
-- 0022_v_combo_profitability_v2.sql
--
-- Rewrites v_combo_profitability to fix two real problems with v1
-- (0019):
--
--   1. Single-sale "medians."   p_min_pair_listings only required 20
--      total listings (live + sold) — pairs with sold_count = 1 ranked
--      to the top because percentile_cont(0.5) of one row is that row's
--      price. A single $1,250 outlier sale of a complex multi-trait
--      gecko got attributed to every pair of tokens that gecko was
--      tagged with (Red × Snowflake, Partial Pinstripe × Red,
--      Red Base × Tri-Color, …) and they all surfaced with $1,250
--      "medians." We now require p_min_sold_count actual sales (default
--      3) so the median is statistically meaningful.
--
--   2. Incidental pair labels.  Auto-discovered pairs emit a tile for
--      every pair of frequent trait tokens that co-occur on the same
--      listing. A listing tagged with 8 traits emits C(8,2)=28 pairs.
--      Many of these are statistical noise — "Snowflake × Tri-Color"
--      is not a combo anyone shops for. The new function joins each
--      token to public.trait_tiers (migration 0021) and:
--        * orders the pair name so the lower-tier (more primary) token
--          comes first — "Axanthic × Snowflake" not "Snowflake × Axanthic"
--        * returns is_incidental = true when both tokens are Tier 3
--          (cosmetic descriptors only). The UI surfaces incidental
--          combos in a separate section so the main ranking shows
--          combos with at least one real value-driver.
--
-- Backwards compat: existing columns are preserved and three new ones
-- are appended (combo_rank, is_incidental, primary_token).
-- ============================================================================

drop function if exists public.v_combo_profitability(int, int, int);

create or replace function public.v_combo_profitability(
  p_window_days        int default 90,
  p_min_top_trait_n    int default 25,
  p_min_pair_listings  int default 20,
  p_min_sold_count     int default 3
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
  confidence        int,
  combo_rank        int,     -- tier sum; T1+T1=2 best, T3+T3=6 worst
  is_incidental     boolean, -- true when both tokens are Tier 3
  primary_token     text     -- lower-tier token in the pair (null for anchors)
)
language sql
stable
parallel safe
set search_path = public
as $body$
with
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
sold_events as (
  select distinct lse.listing_id
  from public.listing_status_events lse
  where lse.status = 'sold'
    and lse.observed_at >= now() - make_interval(days => p_window_days)
),
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
      filter (where effective_status = 'live') as median_ask,
    -- Anchor combo_rank = sum of tiers of its tokens, clamped to the
    -- same 2..6 range pairs use so they sort together.
    least(6, greatest(2,
      (select coalesce(sum(coalesce(tt.tier, 3)), 6)::int
       from public.combo_catalog cc
       cross join lateral unnest(cc.tokens) as token
       left join public.trait_tiers tt on tt.trait_token = token
       where cc.combo_name = anchor_classified.combo_name
       limit 1
      )
    )) as combo_rank,
    false as is_incidental,
    null::text as primary_token
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
    -- Primary token = lower tier (more value-driving). Tie-break on
    -- alphabetic so the same pair always renders with the same name.
    case
      when coalesce(tier1.tier, 3) < coalesce(tier2.tier, 3) then t1.token
      when coalesce(tier1.tier, 3) > coalesce(tier2.tier, 3) then t2.token
      else least(t1.token, t2.token)
    end as primary_token,
    case
      when coalesce(tier1.tier, 3) < coalesce(tier2.tier, 3) then t2.token
      when coalesce(tier1.tier, 3) > coalesce(tier2.tier, 3) then t1.token
      else greatest(t1.token, t2.token)
    end as secondary_token,
    coalesce(tier1.tier, 3) + coalesce(tier2.tier, 3) as combo_rank,
    (coalesce(tier1.tier, 3) = 3 and coalesce(tier2.tier, 3) = 3) as is_incidental
  from listing_tokens t1
  join listing_tokens t2 on t1.id = t2.id and t1.token < t2.token
  join top_traits ta on ta.token = t1.token
  join top_traits tb on tb.token = t2.token
  left join public.trait_tiers tier1 on tier1.trait_token = t1.token
  left join public.trait_tiers tier2 on tier2.trait_token = t2.token
  left join sold_events se on se.listing_id = t1.id
  where t1.id in (select id from in_window_listings)
     or se.listing_id is not null
),
pair_rollup as (
  select
    coalesce(td_primary.display_name, initcap(primary_token))
      || ' × '
      || coalesce(td_secondary.display_name, initcap(secondary_token)) as combo_name,
    'discovered'::text as combo_source,
    count(*) filter (where effective_status = 'sold')::int as sold_count,
    count(*) filter (where effective_status = 'live')::int as live_count,
    percentile_cont(0.5) within group (order by price_usd_equivalent)
      filter (where effective_status = 'sold') as median_sold,
    percentile_cont(0.5) within group (order by price_usd_equivalent)
      filter (where effective_status = 'live') as median_ask,
    min(combo_rank)::int as combo_rank,
    bool_and(is_incidental) as is_incidental,
    primary_token
  from listing_pairs
  left join public.trait_tiers td_primary on td_primary.trait_token = primary_token
  left join public.trait_tiers td_secondary on td_secondary.trait_token = secondary_token
  group by primary_token, secondary_token, td_primary.display_name, td_secondary.display_name
  having count(*) >= p_min_pair_listings
),
-- Sorted-token dedup key so anchor "Lilly White × Cappuccino" and
-- discovered "Cappuccino × Lilly White" merge — same pair, different
-- string order. Without this both surface as separate rows with
-- identical metrics.
anchor_keyed as (
  select
    ar.*,
    (select string_agg(trim(both ' ' from t), '|' order by trim(both ' ' from t))
     from regexp_split_to_table(lower(ar.combo_name), '×') as t) as dedup_key
  from anchor_rollup ar
),
pair_keyed as (
  select
    pr.*,
    (select string_agg(trim(both ' ' from t), '|' order by trim(both ' ' from t))
     from regexp_split_to_table(lower(pr.combo_name), '×') as t) as dedup_key
  from pair_rollup pr
),
combined as (
  select combo_name, combo_source, sold_count, live_count, median_sold, median_ask,
         combo_rank, is_incidental, primary_token
  from anchor_keyed
  union all
  select combo_name, combo_source, sold_count, live_count, median_sold, median_ask,
         combo_rank, is_incidental, primary_token
  from pair_keyed
  where dedup_key not in (select dedup_key from anchor_keyed)
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
  least(99,
    greatest(1,
      round((10 + c.sold_count * 4 + c.live_count * 0.4)::numeric)
    )
  )::int as confidence,
  c.combo_rank,
  c.is_incidental,
  c.primary_token
from combined c
where c.sold_count >= p_min_sold_count;
$body$;

grant execute on function public.v_combo_profitability(int, int, int, int) to anon, authenticated;
