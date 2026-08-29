-- ============================================================================
-- Geck Data 0052: how far back the observations actually go.
--
-- The market dashboard's timeframe control offers 30 days, 90 days, 6 months,
-- 12 months and 24 months. price_history starts on 2026-04-22, so as of today
-- there are 129 days of observation. The last three options therefore return
-- byte-identical results: each one means "everything we have", and picking
-- between them changes the label and nothing else.
--
-- That is the same failure the region, age, lineage and source controls were
-- already disabled for. A control that confirms a change it did not make is
-- worse than no control, and the dashboard already states that rule in
-- FilterBar's header comment. The timeframe control was the one that escaped
-- it, because its longest options break silently rather than visibly.
--
-- The span is not a constant to hard-code: it grows by a day every day, and
-- an option that is meaningless today becomes meaningful once the archive is
-- deep enough. So the client asks, and the answer is measured.
--
-- first_listing_at is deliberately separate. Listings go back to 2023-02-25
-- because MorphMarket reports when the animal was first advertised, but a
-- listing's stated age is not evidence of what we watched. Only price_history
-- says what this warehouse actually observed, so that is what bounds a
-- timeframe.
-- ============================================================================

create or replace function public.observation_span()
returns table (
  first_observed_at timestamptz,
  last_observed_at  timestamptz,
  observed_days     integer,
  span_days         integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    min(ph.observed_at),
    max(ph.observed_at),
    count(distinct ph.observed_at::date)::integer,
    case
      when min(ph.observed_at) is null then 0
      else (max(ph.observed_at)::date - min(ph.observed_at)::date)::integer
    end
  from public.price_history ph;
$$;

comment on function public.observation_span() is
  'Oldest and newest price observation, the number of distinct days carrying one, and the calendar span between the ends. Used to disable timeframe options longer than the archive can distinguish. Deliberately reads price_history rather than listing dates: a listing advertised in 2023 is not evidence this warehouse watched anything in 2023.';

revoke all on function public.observation_span() from public;
grant execute on function public.observation_span() to anon, authenticated, service_role;
