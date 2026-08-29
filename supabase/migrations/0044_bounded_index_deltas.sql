-- ============================================================================
-- Geck Data 0044: index deltas that refuse to lie across a gap.
--
-- Two defects in v_combo_index_summary, both of which render missing history
-- as measured stability:
--
-- 1. WRONG ANCHOR. The 7/30/90d priors were selected with
--    `day <= CURRENT_DATE - N`. For a combo whose newest row is months old,
--    its own latest row satisfies that predicate, so the view compared the
--    value against itself and published +0.00%. The audit screenshotted a
--    whole /indices table reading "+0.0%" everywhere, which a visitor reads
--    as a flat market rather than as absent data. Anchor on each combo's
--    own latest_day instead.
--
-- 2. NO BASELINE AGE BOUND. Even anchored correctly, the nearest prior row
--    can sit on the far side of the 78-day ingest outage, so a "7 day change"
--    was really 81 days of change. A baseline is now only accepted when its
--    lag is inside the labeled horizon plus a tolerance
--    (N + max(7, N/2)): 7d accepts 7..14 days, 30d accepts 30..45, 90d
--    accepts 90..135. Outside that the delta is null, and the UI is expected
--    to say "no baseline in window" rather than draw a zero.
--
-- With today's data that is exactly the honest outcome: 7d and 30d go null
-- (nothing was observed 7 or 30 days before the newest observation) while
-- 90d survives, because 2026-05-31 really is 90 days before 2026-08-29 and
-- both ends have real observations.
--
-- A third rule: when the combo's own latest observation is stale (older than
-- 14 days) every delta is null regardless of baseline. A "7 day change"
-- computed between 2026-05-04 and 2026-05-11 is a real May measurement, but
-- publishing it today under a "7d" header tells a visitor the market moved
-- that way this week. 1,774 of 2,473 combos are in that state, and 1,142 of
-- them were printing exactly 0.00%.
--
-- Every existing column is preserved so current callers keep working; the
-- additions (baseline days, lags, observed_days, is_stale) let the UI
-- disclose exactly what each delta is measured against.
-- ============================================================================

create or replace view public.v_combo_index_summary as
with latest as (
  select distinct on (combo_id)
    combo_id,
    day           as latest_day,
    median_price  as current_value,
    n             as latest_n
  from public.combo_index_daily
  order by combo_id, day desc
),
totals as (
  select
    combo_id,
    sum(n)::bigint       as total_n,
    count(*)::bigint     as observed_days,
    min(day)             as first_day
  from public.combo_index_daily
  group by combo_id
)
select
  -- Existing column order is preserved: CREATE OR REPLACE VIEW can only
  -- append columns, and /indices already selects these by name.
  l.combo_id,
  l.latest_day,
  l.current_value,
  l.latest_n,
  coalesce(t.total_n, l.latest_n) as total_n,

  case when l.latest_day < current_date - 14 then null
       when b7.median_price is null or b7.median_price = 0 then null
       else round((l.current_value - b7.median_price) / b7.median_price * 100, 2)
  end as delta_7d,
  case when l.latest_day < current_date - 14 then null
       when b30.median_price is null or b30.median_price = 0 then null
       else round((l.current_value - b30.median_price) / b30.median_price * 100, 2)
  end as delta_30d,
  case when l.latest_day < current_date - 14 then null
       when b90.median_price is null or b90.median_price = 0 then null
       else round((l.current_value - b90.median_price) / b90.median_price * 100, 2)
  end as delta_90d,

  -- Disclosure columns appended below.
  t.observed_days,
  t.first_day,
  (l.latest_day < current_date - 14) as is_stale,
  (current_date - l.latest_day)      as latest_age_days,
  b7.day  as baseline_7d_day,
  b30.day as baseline_30d_day,
  b90.day as baseline_90d_day,
  case when b7.day  is not null then (l.latest_day - b7.day)  end as baseline_7d_lag_days,
  case when b30.day is not null then (l.latest_day - b30.day) end as baseline_30d_lag_days,
  case when b90.day is not null then (l.latest_day - b90.day) end as baseline_90d_lag_days
from latest l
left join totals t on t.combo_id = l.combo_id
-- Baseline = newest row at least N days before THIS combo's latest day, and
-- no older than N + max(7, N/2), so a delta never spans the outage.
left join lateral (
  select c.day, c.median_price
  from public.combo_index_daily c
  where c.combo_id = l.combo_id
    and c.day <= l.latest_day - 7
    and c.day >= l.latest_day - (7 + greatest(7, 7 / 2))
  order by c.day desc
  limit 1
) b7 on true
left join lateral (
  select c.day, c.median_price
  from public.combo_index_daily c
  where c.combo_id = l.combo_id
    and c.day <= l.latest_day - 30
    and c.day >= l.latest_day - (30 + greatest(7, 30 / 2))
  order by c.day desc
  limit 1
) b30 on true
left join lateral (
  select c.day, c.median_price
  from public.combo_index_daily c
  where c.combo_id = l.combo_id
    and c.day <= l.latest_day - 90
    and c.day >= l.latest_day - (90 + greatest(7, 90 / 2))
  order by c.day desc
  limit 1
) b90 on true;

comment on view public.v_combo_index_summary is
  'Per-combo latest value with 7/30/90d deltas anchored on the combo latest_day and bounded by baseline age. A null delta means no baseline inside the labeled horizon, which is not the same as no change. baseline_*_day and baseline_*_lag_days say what each delta was measured against.';
