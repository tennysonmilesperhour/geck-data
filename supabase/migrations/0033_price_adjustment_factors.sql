-- ============================================================================
-- Geck Data 0033: price-adjustment multipliers.
--
-- Backs /api/market/fair-price. The base price distribution per canonical
-- combo comes from v_combo_price_distribution (migration 0029); this
-- migration adds the layer that adjusts that band for the gecko's
-- individual attributes (age, sex, weight, proven status).
--
-- Why multipliers rather than further segmentation of the view:
--   Segmenting v_combo_price_distribution by (combo, age, sex, proven)
--   fragments sample sizes to nothing for rare combos — e.g., only
--   ~4 sold "proven breeder" Lilly White × Axanthic in any 180d window.
--   Multipliers borrow strength across combos: a proven-breeder uplift
--   applies the same way to all morphs, derived from the population
--   average, and stays statistically meaningful.
--
-- The seed values are hand-tuned from breeder forum wisdom for v1. A
-- follow-up cron job (POST /api/training/refresh-adjustments) regresses
-- observed sold prices on these factors over the last 180 days and
-- overwrites the seeds with empirical multipliers, so this table is
-- self-correcting from real data without any code redeploy.
-- ============================================================================

create table if not exists public.price_adjustment_factors (
  id bigserial primary key,
  -- Factor category. Each row defines one bucket within one category.
  category text not null check (category in (
    'age', 'sex', 'proven', 'weight_bucket'
  )),
  -- Category bucket value:
  --   age:           hatchling | juvenile | subadult | adult | proven_breeder
  --   sex:           male | female | unknown
  --   proven:        true | false
  --   weight_bucket: underweight | normal | heavy  (relative to age class)
  bucket text not null,
  -- Multiplier applied to the base price. 1.0 = no adjustment.
  multiplier numeric not null check (multiplier > 0),
  -- How we derived this value. 'seed' for the v1 hand-tuned numbers,
  -- 'empirical_<timestamp>' for the refresh job's writes.
  source text not null default 'seed',
  -- Sample size used to derive the empirical multiplier. NULL for seeds.
  n_samples int,
  updated_at timestamptz not null default now(),
  unique (category, bucket)
);

create index if not exists idx_price_factors_category
  on public.price_adjustment_factors(category);

alter table public.price_adjustment_factors enable row level security;
drop policy if exists "public read price factors" on public.price_adjustment_factors;
create policy "public read price factors" on public.price_adjustment_factors
  for select using (true);

-- ----------------------------------------------------------------------------
-- Seed multipliers. Re-applying this migration is a no-op for any row that
-- has been updated by the refresh job (we ON CONFLICT DO NOTHING so an
-- empirical value isn't overwritten by the seed). To force a reset, the
-- operator can DELETE the row first.
-- ----------------------------------------------------------------------------
insert into public.price_adjustment_factors (category, bucket, multiplier, source) values
  -- Age class. Subadult is the baseline (1.00); hatchlings discounted
  -- because they're a longer hold for the buyer, adults priced as
  -- close-to-breeding stock.
  ('age', 'hatchling',      0.55, 'seed'),
  ('age', 'juvenile',       0.75, 'seed'),
  ('age', 'subadult',       1.00, 'seed'),
  ('age', 'adult',          1.20, 'seed'),
  ('age', 'proven_breeder', 1.40, 'seed'),
  ('age', 'unknown',        1.00, 'seed'),
  -- Sex. Female premium because they produce eggs; males serve one harem.
  ('sex', 'female',  1.15, 'seed'),
  ('sex', 'male',    1.00, 'seed'),
  ('sex', 'unknown', 1.00, 'seed'),
  -- Proven flag — distinct from age=proven_breeder so a young confirmed
  -- breeder also picks up the bonus.
  ('proven', 'true',  1.10, 'seed'),
  ('proven', 'false', 1.00, 'seed'),
  -- Weight relative to age class. Buckets are computed in the endpoint:
  --   adult/proven < 35g  -> underweight
  --   adult/proven >= 60g -> heavy
  --   subadult   < 18g    -> underweight
  --   subadult   >= 40g   -> heavy
  --   etc. — see lib/market/price-adjust.ts
  ('weight_bucket', 'underweight', 0.85, 'seed'),
  ('weight_bucket', 'normal',      1.00, 'seed'),
  ('weight_bucket', 'heavy',       1.05, 'seed')
on conflict (category, bucket) do nothing;

-- ----------------------------------------------------------------------------
-- v_recent_combo_sales — the 5 most recent comparable sales per combo,
-- used by /api/market/fair-price?recent_sales=N to give the morph-card
-- response three or five concrete examples next to the percentile band.
-- ----------------------------------------------------------------------------
create or replace view public.v_recent_combo_sales as
select
  public._combo_id_from_traits(coalesce(ml.cached_traits, ml.norm_traits)) as combo_id,
  ml.id                                                                    as listing_id,
  coalesce(ml.price_usd_equivalent, ml.price)                              as sold_usd,
  lse.observed_at                                                          as sold_at,
  lse.days_since_first_seen                                                as days_to_sell,
  ml.seller_name                                                           as seller_name,
  ml.url                                                                   as source_url
from public.market_listings ml
join public.listing_status_events lse
  on lse.listing_id = ml.id
 and lse.status = 'sold'
 and lse.observed_at >= now() - interval '180 days'
where ml.species in ('crested','unknown')
  and coalesce(ml.price_usd_equivalent, ml.price) is not null
  and coalesce(ml.price_usd_equivalent, ml.price) > 0
  and public._combo_id_from_traits(coalesce(ml.cached_traits, ml.norm_traits)) is not null
order by lse.observed_at desc;
