-- ============================================================================
-- Geck Data 0051: movers with two endpoints that are actually different.
--
-- Top Movers has been suppressed on the market dashboard since the audit,
-- and the reason was structural rather than a missing feature. It compared
-- v_combo_rollups(w) against v_combo_rollups(2w). The 2w window contains the
-- w window, so every delta was damped toward zero by construction: a combo
-- that doubled inside w was measured against a baseline that already included
-- the doubling. There is no honest number to recover from nested windows.
--
-- combo_index_daily gives two genuinely disjoint endpoints. It holds one
-- median per combo per observed day, so a mover is that combo's index on its
-- latest observed day against its index on a day at least lookback_days
-- earlier. Nothing is nested and nothing is inferred between the two dates.
--
-- Depth is the whole ballgame here. Ungated, the largest "movers" in this
-- data are combos with one listing on the latest day: a single $5,850 ad
-- currently sets the index for six different combos at once, and produces a
-- +5,057% move on a combo whose latest day has two listings. min_n applies to
-- both endpoints for that reason. At min_n = 5 there are 131 real movers; at
-- min_n = 1 there are 625, and the top of that list is noise.
--
-- What this still cannot say: these are asking prices, not sales, and the
-- current index rests on far fewer listings than the baseline does (typically
-- 6 against 40), because the live catalogue shrank between the two dates. The
-- endpoint counts are returned so a caller can show that rather than bury it,
-- and the two dates are returned so nothing has to imply continuous tracking
-- across a gap where the ingest simply was not running.
-- ============================================================================

create or replace function public.combo_index_movers(
  lookback_days integer default 90,
  min_n integer default 5,
  max_rows integer default 20
)
returns table (
  combo_id     text,
  from_day     date,
  to_day       date,
  from_value   numeric,
  to_value     numeric,
  from_n       bigint,
  to_n         bigint,
  pct_change   numeric,
  span_days    integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select least(greatest(coalesce(lookback_days, 90), 1), 1825) as lookback,
           greatest(coalesce(min_n, 5), 1)                       as floor_n,
           least(greatest(coalesce(max_rows, 20), 1), 200)       as cap
  ),
  latest as (
    select combo_id, max(day) as d
    from public.combo_index_daily
    group by combo_id
  ),
  cur as (
    select c.combo_id, c.day, c.median_price, c.n
    from public.combo_index_daily c
    join latest l on l.combo_id = c.combo_id and l.d = c.day
  ),
  -- The newest observed day at or before the lookback horizon, bounded below
  -- so a baseline cannot silently drift years back when the index has a gap.
  -- Half the lookback is the slack, matching the bounding rule the index
  -- summary view uses for its own deltas.
  base as (
    select distinct on (c.combo_id)
      c.combo_id, c.day, c.median_price, c.n
    from public.combo_index_daily c
    join latest l on l.combo_id = c.combo_id
    cross join params p
    where c.day <= l.d - p.lookback
      and c.day >= l.d - (p.lookback + greatest(14, p.lookback / 2))
    order by c.combo_id, c.day desc
  )
  select
    cur.combo_id,
    base.day,
    cur.day,
    base.median_price,
    cur.median_price,
    base.n,
    cur.n,
    round(100.0 * (cur.median_price - base.median_price) / base.median_price, 1),
    (cur.day - base.day)::integer
  from cur
  join base on base.combo_id = cur.combo_id
  cross join params p
  where base.median_price > 0
    and cur.n >= p.floor_n
    and base.n >= p.floor_n
  order by abs((cur.median_price - base.median_price) / base.median_price) desc
  limit (select cap from params);
$$;

comment on function public.combo_index_movers(integer, integer, integer) is
  'Largest moves in the combo asking-price index between two disjoint observed days: each combo latest observed day against the newest day at least lookback_days earlier. Both endpoints must carry at least min_n listings, since ungated the list is dominated by combos priced off a single ad. Returns both dates and both counts so a caller can show what the move rests on.';

revoke all on function public.combo_index_movers(integer, integer, integer) from public;
grant execute on function public.combo_index_movers(integer, integer, integer) to anon, authenticated, service_role;
