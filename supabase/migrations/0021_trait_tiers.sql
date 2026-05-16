-- ============================================================================
-- 0021_trait_tiers.sql
--
-- Classifies crested gecko trait tokens into three tiers so the
-- profitability ranking can distinguish value-driving traits from
-- incidental descriptors.
--
--   Tier 1  Genetic morphs — predictable inheritance, breeder demand drivers
--           (Axanthic, Lilly White, Cappuccino, Frappuccino, Moonglow,
--           Sable, Soft Scale, Phantom, het-* versions).
--
--   Tier 2  Premium structural patterns — desirable look traits that aren't
--           simple-recessive genetic morphs but command a premium
--           (Extreme Harlequin, Full Pinstripe, Super Dalmatian, Crowned,
--           Drippy, Quad-Stripe, …).
--
--   Tier 3  Cosmetic descriptors — colours, markings, base coats, generic
--           pattern descriptors that ride along on listings whose value
--           comes from a Tier 1/2 trait (Snowflake, Tri-Color, Red,
--           Harlequin, Dalmatian, Partial Pinstripe, …).
--
-- The point is that pairs like "Snowflake × Tri-Color" should NOT surface
-- as a top profitability combo: buyers don't search for that pairing.
-- Instead "Axanthic × Snowflake" matters because Axanthic is the
-- value driver and Snowflake is a complementary marking.
--
-- Editable at any time: this is a data table, not hard-coded logic.
-- `update public.trait_tiers set tier = 2 where trait_token = 'crowned';`
-- takes effect on the next v_combo_profitability call.
-- ============================================================================

create table if not exists public.trait_tiers (
  trait_token  text primary key,        -- lowercased, matches listing tokens
  tier         int  not null check (tier between 1 and 3),
  display_name text not null,
  notes        text
);

comment on table public.trait_tiers is
  'Classification of trait tokens for combo profitability ranking. Tier 1 = genetic value-driver, Tier 2 = premium pattern, Tier 3 = cosmetic descriptor.';

-- ---- Tier 1: genetic morphs ------------------------------------------------
insert into public.trait_tiers (trait_token, tier, display_name) values
  ('lilly white',           1, 'Lilly White'),
  ('cappuccino',            1, 'Cappuccino'),
  ('axanthic',              1, 'Axanthic'),
  ('frappuccino',           1, 'Frappuccino'),
  ('moonglow',              1, 'Moonglow'),
  ('sable',                 1, 'Sable'),
  ('soft scale',            1, 'Soft Scale'),
  ('super soft scale',      1, 'Super Soft Scale'),
  ('phantom',               1, 'Phantom'),
  ('het axanthic',          1, 'Het Axanthic'),
  ('50% het axanthic',      1, '50% Het Axanthic'),
  ('66% het axanthic',      1, '66% Het Axanthic'),
  ('pos het axanthic',      1, 'Pos Het Axanthic'),
  ('het phantom',           1, 'Het Phantom'),
  ('50% het phantom',       1, '50% Het Phantom')
on conflict (trait_token) do update
  set tier = excluded.tier,
      display_name = excluded.display_name;

-- ---- Tier 2: premium structural patterns -----------------------------------
insert into public.trait_tiers (trait_token, tier, display_name) values
  ('extreme harlequin',     2, 'Extreme Harlequin'),
  ('full pinstripe',        2, 'Full Pinstripe'),
  ('pinstripe',             2, 'Pinstripe'),
  ('super dalmatian',       2, 'Super Dalmatian'),
  ('crowned',               2, 'Crowned'),
  ('drippy',                2, 'Drippy'),
  ('quad-stripe',           2, 'Quad-Stripe'),
  ('reverse pinstripe',     2, 'Reverse Pinstripe'),
  ('super stripe',          2, 'Super Stripe'),
  ('super fire',            2, 'Super Fire'),
  ('patternless',           2, 'Patternless'),
  ('highway',               2, 'Highway')
on conflict (trait_token) do update
  set tier = excluded.tier,
      display_name = excluded.display_name;

-- ---- Tier 3: cosmetic descriptors ------------------------------------------
insert into public.trait_tiers (trait_token, tier, display_name) values
  ('harlequin',             3, 'Harlequin'),
  ('tri-color',             3, 'Tri-Color'),
  ('dark',                  3, 'Dark'),
  ('dalmatian',             3, 'Dalmatian'),
  ('yellow',                3, 'Yellow'),
  ('cream',                 3, 'Cream'),
  ('red',                   3, 'Red'),
  ('white wall',            3, 'White Wall'),
  ('red base',              3, 'Red Base'),
  ('partial pinstripe',     3, 'Partial Pinstripe'),
  ('portholes',             3, 'Portholes'),
  ('black base',            3, 'Black Base'),
  ('empty back',            3, 'Empty Back'),
  ('lavender',              3, 'Lavender'),
  ('tangerine',             3, 'Tangerine'),
  ('snowflake',             3, 'Snowflake'),
  ('orange',                3, 'Orange'),
  ('orange patterning',     3, 'Orange Patterning'),
  ('white patterning',      3, 'White Patterning'),
  ('ink spot',              3, 'Ink Spot'),
  ('tiger',                 3, 'Tiger'),
  ('brindle',               3, 'Brindle'),
  ('yellow base',           3, 'Yellow Base'),
  ('fringing',              3, 'Fringing'),
  ('white out',             3, 'White Out'),
  ('flame',                 3, 'Flame'),
  ('red spot',              3, 'Red Spot'),
  ('black',                 3, 'Black'),
  ('kneecaps',              3, 'Kneecaps'),
  ('hypo',                  3, 'Hypo'),
  ('pin-dashed',            3, 'Pin-Dashed'),
  ('white tip',             3, 'White Tip'),
  ('oil spot',              3, 'Oil Spot'),
  ('halloween',             3, 'Halloween'),
  ('blushing',              3, 'Blushing')
on conflict (trait_token) do update
  set tier = excluded.tier,
      display_name = excluded.display_name;

grant select on public.trait_tiers to anon, authenticated;
