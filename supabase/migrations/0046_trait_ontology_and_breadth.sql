-- ============================================================================
-- Geck Data 0046: stop presenting one trait as a two-trait combo.
--
-- 0037 explodes every pair of comma-separated traits on a listing, so the
-- top "combos" on /indices included Extreme Harlequin x Harlequin,
-- Dalmatian x Super Dalmatian and Red x Red Base. Those are not two
-- independent genetic factors that a breeder can pair. They are the same
-- trait at a different expression level, the homozygous form of the same
-- incomplete dominant, an allelic sibling, or two overlapping labels for the
-- same feature. Charting them as combos invents an economic relationship.
--
-- Approach. Rather than hand-enumerating crested gecko genetics (easy to get
-- subtly wrong, and the trait vocabulary keeps growing), the redundancy test
-- is mostly structural:
--
--   1. MODIFIER PREFIXES. Strip a known qualifier from each side and compare.
--      "Super Dalmatian" and "Dalmatian" reduce to the same root, so do
--      "Extreme Harlequin"/"Harlequin", "Partial Pinstripe"/"Pinstripe",
--      "Het Axanthic"/"Axanthic" and "Pos Dalmatian"/"Dalmatian". A het or
--      possible state is a zygosity claim about one locus, not a second
--      trait, so it cannot combo with its own base trait.
--
--   2. AN EXPLICIT RELATION TABLE for pairs the prefix rule cannot see:
--      allelic siblings (Cappuccino / Sable / Frappuccino share a locus) and
--      overlapping labels (Red / Red Base, Pinstripe / Quad-stripe).
--      Seeded conservatively. Only relationships stated with confidence are
--      included; anything doubtful is left out so the site under-claims
--      rather than over-claims. New rows can be added without a migration.
--
-- Nothing is deleted. combo_index_daily keeps every pair it observes; this
-- adds the flag and the breadth counts so read paths can require a real
-- combo with enough independent evidence before charting it.
--
-- Breadth: the audit's release gate asks for minimum unique LISTINGS and
-- unique SELLERS, because one breeder listing the same project twenty times
-- is not twenty data points. v_combo_breadth supplies both. Measured at
-- ~195ms on production, inside the 3s anon statement timeout.
-- ============================================================================

create table if not exists public.trait_relations (
  trait_a   text not null,
  trait_b   text not null,
  relation  text not null,
  note      text,
  primary key (trait_a, trait_b)
);

comment on table public.trait_relations is
  'Pairs of trait labels that must not be treated as an independent two-trait combo. relation: allelic (same locus), overlapping_label (two names for one feature), expression_level (same trait, different degree).';

alter table public.trait_relations enable row level security;

drop policy if exists trait_relations_public_read on public.trait_relations;
create policy trait_relations_public_read on public.trait_relations for select using (true);

insert into public.trait_relations (trait_a, trait_b, relation, note) values
  ('cappuccino', 'sable',        'allelic', 'Cappuccino and Sable are alleles at the same locus'),
  ('cappuccino', 'frappuccino',  'allelic', 'Frappuccino is the Cappuccino/Sable compound, not an independent trait'),
  ('sable',      'frappuccino',  'allelic', 'Frappuccino is the Cappuccino/Sable compound, not an independent trait'),
  ('red',        'red base',     'overlapping_label', 'Base colour label overlaps the colour label'),
  ('pinstripe',  'quad-stripe',  'expression_level', 'Quad-stripe is a pinstriping expression'),
  ('pinstripe',  'quad stripe',  'expression_level', 'Quad-stripe is a pinstriping expression')
on conflict (trait_a, trait_b) do nothing;

-- Reduce a trait label to its root by stripping qualifier prefixes.
create or replace function public._trait_root(label text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both ' ' from
      regexp_replace(
        lower(coalesce(label, '')),
        '^(super\s+extreme|super|extreme|partial|full|het|poss|pos|possible|reduced|high|low)\s+',
        '',
        'g'
      )
    ),
  '');
$$;

comment on function public._trait_root(text) is
  'Trait label with qualifier prefixes (super, extreme, partial, full, het, pos, ...) removed, so expression levels and zygosity states collapse onto the trait they qualify.';

-- Are these two labels really the same trait wearing different words?
create or replace function public._traits_are_redundant(a text, b text)
returns boolean
language sql
stable
as $$
  select case
    when a is null or b is null then false
    when lower(trim(a)) = lower(trim(b)) then true
    when public._trait_root(a) is not null
     and public._trait_root(a) = public._trait_root(b) then true
    else exists (
      select 1 from public.trait_relations r
      where (r.trait_a = lower(trim(a)) and r.trait_b = lower(trim(b)))
         or (r.trait_a = lower(trim(b)) and r.trait_b = lower(trim(a)))
         or (r.trait_a = public._trait_root(a) and r.trait_b = public._trait_root(b))
         or (r.trait_a = public._trait_root(b) and r.trait_b = public._trait_root(a))
    )
  end;
$$;

comment on function public._traits_are_redundant(text, text) is
  'True when two trait labels describe the same underlying trait (same root after stripping qualifiers, or a seeded allelic/overlapping relation). Such a pair is not a combo.';

-- Per-combo evidence breadth: unique listings and unique sellers, plus the
-- redundancy verdict. Single animals only (group lots price a group).
create or replace view public.v_combo_breadth as
with lt as (
  select
    ml.id,
    ml.seller_id,
    array_agg(distinct trim(both ' ' from t.t))
      filter (where length(trim(both ' ' from t.t)) between 2 and 60) as traits
  from public.market_listings ml,
       lateral unnest(string_to_array(ml.cached_traits, ',')) t(t)
  where ml.cached_traits is not null
    and ml.species in ('crested', 'unknown')
    and not ml.is_group_lot
  group by ml.id, ml.seller_id
),
pairs as (
  select
    (least(lt.traits[i.i], lt.traits[j.j]) || ' x ' || greatest(lt.traits[i.i], lt.traits[j.j])) as combo_id,
    least(lt.traits[i.i], lt.traits[j.j])    as trait_a,
    greatest(lt.traits[i.i], lt.traits[j.j]) as trait_b,
    lt.id,
    lt.seller_id
  from lt,
       lateral generate_subscripts(lt.traits, 1) i(i),
       lateral generate_subscripts(lt.traits, 1) j(j)
  where i.i < j.j
    and array_length(lt.traits, 1) >= 2
)
select
  combo_id,
  min(trait_a) as trait_a,
  min(trait_b) as trait_b,
  count(distinct id)::bigint        as n_listings,
  count(distinct seller_id)::bigint as n_sellers,
  public._traits_are_redundant(min(trait_a), min(trait_b)) as is_redundant_pair
from pairs
group by combo_id;

comment on view public.v_combo_breadth is
  'Evidence breadth per observed trait pair: unique listings and unique sellers, single animals only, plus is_redundant_pair for pairs that are really one trait. Read paths should require a real pair and a minimum breadth before charting a combo.';

grant select on public.v_combo_breadth to anon, authenticated, service_role;
grant select on public.trait_relations to anon, authenticated, service_role;
