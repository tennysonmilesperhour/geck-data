-- ============================================================================
-- Geck Data 0045: one computed coverage signal, and an honest sold ledger.
--
-- PART 1: market_coverage()
--
-- StaleDataBanner keys off max(last_seen_at). One fresh batch of 565 rows
-- therefore clears a site-wide warning while 9,274 rows have not been
-- re-observed since June. The same 48h rule also breaks the other way under
-- the new weekly ingest: from Wednesday to Monday every week the newest
-- observation is legitimately older than 48h, so a correct feed would raise
-- an alarm five days out of seven. A banner that cries wolf that often
-- trains people to ignore the one outage that matters.
--
-- Coverage, not recency, is the signal that means something: what share of
-- the catalog did the newest complete pass actually re-observe? This returns
-- both, plus the observed-day counts, so the UI can say
-- "Partial coverage: asks 2h, sold 106d" instead of a green dot.
--
-- PART 2: v_sold_reconciled
--
-- Three ledgers disagree by 35x and the public page reads the smallest:
--   listing_status_events sold  92 rows, all 2026-05-11..05-14
--   market_listings sold        81 rows
--   listings.sold_at         2,849 rows, 2026-05-17..06-07
-- The audit is explicit that these must NOT be blindly unioned: the
-- inference methods and price semantics differ. So this view keeps them
-- side by side with an explicit sold_basis, and callers choose.
--
-- It also suppresses the days_to_sell artifact. 84 of the 92 captured events
-- carry days_since_first_seen = 0 because first_seen and the sold event were
-- stamped in the same bootstrap import, which is why /sold advertised a
-- median time-to-sell of 0 days. Where first_seen and sold land within the
-- same hour the duration is not measured, it is an import coincidence, and
-- days_to_sell comes back null.
-- ============================================================================

create or replace function public.market_coverage(fresh_hours integer default 48)
returns table (
  total_live              bigint,
  fresh_live              bigint,
  stale_live              bigint,
  coverage_pct            numeric,
  newest_observation_at   timestamptz,
  observation_age_hours   numeric,
  last_complete_pass_at   timestamptz,
  observed_days_30        bigint,
  observed_days_90        bigint,
  newest_sold_at          timestamptz,
  sold_age_days           numeric,
  captured_sold_events    bigint,
  inferred_sold_records   bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with cutoff as (
    select timezone('UTC', now())
      - make_interval(hours => least(greatest(coalesce(fresh_hours, 48), 1), 8760)) as fresh_since
  ),
  live as (
    select ml.last_seen_at, (ml.last_seen_at >= c.fresh_since) as is_fresh
    from public.market_listings ml, cutoff c
    where ml.current_status = 'live'
      and ml.species in ('crested', 'unknown')
  ),
  agg as (
    select
      count(*)::bigint                          as total_live,
      count(*) filter (where is_fresh)::bigint  as fresh_live,
      count(*) filter (where not is_fresh)::bigint as stale_live,
      max(last_seen_at)                         as newest_observation_at
    from live
  ),
  runs as (
    select max(started_at) as last_complete_pass_at
    from public.scrape_runs
    where status = 'success' and scrape_type = 'listings'
  ),
  days as (
    select
      count(distinct ph.observed_at::date) filter (
        where ph.observed_at >= timezone('UTC', now()) - interval '30 days')::bigint as observed_days_30,
      count(distinct ph.observed_at::date) filter (
        where ph.observed_at >= timezone('UTC', now()) - interval '90 days')::bigint as observed_days_90
    from public.price_history ph
    where ph.observed_at >= timezone('UTC', now()) - interval '90 days'
  ),
  sold as (
    select
      (select max(observed_at) from public.listing_status_events where status = 'sold') as newest_event_at,
      (select count(*) from public.listing_status_events where status = 'sold')::bigint as captured_sold_events,
      (select count(*) from public.listings where sold_at is not null)::bigint          as inferred_sold_records,
      (select max(sold_at) from public.listings)                                        as newest_inferred_at
  )
  select
    a.total_live,
    a.fresh_live,
    a.stale_live,
    case when a.total_live = 0 then null
         else round(a.fresh_live::numeric * 100 / a.total_live, 1) end as coverage_pct,
    a.newest_observation_at,
    case when a.newest_observation_at is null then null
         else round(extract(epoch from (timezone('UTC', now()) - a.newest_observation_at)) / 3600.0, 1)
    end as observation_age_hours,
    r.last_complete_pass_at,
    d.observed_days_30,
    d.observed_days_90,
    greatest(s.newest_event_at, s.newest_inferred_at) as newest_sold_at,
    case when greatest(s.newest_event_at, s.newest_inferred_at) is null then null
         else round(extract(epoch from (timezone('UTC', now()) - greatest(s.newest_event_at, s.newest_inferred_at))) / 86400.0, 1)
    end as sold_age_days,
    s.captured_sold_events,
    s.inferred_sold_records
  from agg a, runs r, days d, sold s;
$$;

comment on function public.market_coverage(integer) is
  'Feed health as coverage, not recency: how much of the live catalog the newest pass re-observed, how old the newest observation and newest sale are, and how many days were observed in the last 30/90. Backs the stale banner and the header status so they cannot disagree.';

-- ----------------------------------------------------------------------------
-- v_sold_reconciled: both sold pools, labeled, never silently merged.
-- ----------------------------------------------------------------------------
create or replace view public.v_sold_reconciled as
-- Pool A: sold transitions the pipeline actually observed.
select
  ml.id,
  ml.seller_id,
  ml.title,
  ml.price,
  ml.price_usd_equivalent,
  ml.maturity,
  ml.sex,
  ml.cached_traits,
  ml.first_seen_at,
  lse.observed_at as sold_at,
  'captured_event'::text as sold_basis,
  lse.source as sold_source,
  ml.is_group_lot,
  -- Only a duration we actually watched elapse. Same-hour stamps come from
  -- one import, not from a listing that sold in under an hour.
  case
    when ml.first_seen_at is null then null
    when lse.observed_at - ml.first_seen_at < interval '1 hour' then null
    else round(extract(epoch from (lse.observed_at - ml.first_seen_at)) / 86400.0)::int
  end as days_to_sell
from public.market_listings ml
join public.listing_status_events lse
  on lse.listing_id = ml.id and lse.status = 'sold'
union all
-- Pool B: listings the catalog walk stopped seeing, inferred sold.
select
  ml.id,
  ml.seller_id,
  ml.title,
  ml.price,
  ml.price_usd_equivalent,
  ml.maturity,
  ml.sex,
  ml.cached_traits,
  ml.first_seen_at,
  l.sold_at,
  'inferred_unseen'::text as sold_basis,
  'scraper'::text as sold_source,
  ml.is_group_lot,
  case
    when ml.first_seen_at is null then null
    when l.sold_at - ml.first_seen_at < interval '1 hour' then null
    else round(extract(epoch from (l.sold_at - ml.first_seen_at)) / 86400.0)::int
  end as days_to_sell
from public.listings l
join public.market_listings ml on ml.id = 'mm_' || l.listing_id
where l.sold_at is not null
  and not exists (
    select 1 from public.listing_status_events e
    where e.listing_id = ml.id and e.status = 'sold'
  );

comment on view public.v_sold_reconciled is
  'Both sold pools with explicit provenance. sold_basis = captured_event (the pipeline saw the transition) or inferred_unseen (the catalog walk stopped seeing the listing, so a sale is inferred). Prices are last observed asks in both cases, never negotiated prices. days_to_sell is null when first_seen and sold were stamped in the same import.';

grant select on public.v_sold_reconciled to anon, authenticated, service_role;
revoke all on function public.market_coverage(integer) from public;
grant execute on function public.market_coverage(integer) to anon, authenticated, service_role;
