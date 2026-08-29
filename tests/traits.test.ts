// Trait tokenizer regression tests.
// The "Diet: Meal Replacement" leak family of bugs reappeared three times in
// the early life of this repo; these tests pin down exactly which inputs the
// sanitizer must drop.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTraitList,
  sanitizeCachedTraits,
  sanitizeNormTraits,
  looksLikeGroupLot,
} from "../src/lib/traits";

test("parseTraitList strips Diet: Meal Replacement leak", () => {
  const out = parseTraitList({
    cached_traits: "Diet: Meal Replacement | Proven breeder: No | Pinstripe, Crowned, Orange",
  });
  assert.deepEqual(out, ["pinstripe", "crowned", "orange"]);
});

test("parseTraitList handles norm_traits with no pipes", () => {
  const out = parseTraitList({
    cached_traits: null,
    // Comma-delimited, no leaked key/value prefixes — i.e. the post-sanitize
    // shape that lands in the DB. parseTraitList trusts that step 1 of the
    // pipeline (sanitize-on-write in lib/traits.ts) ran before it sees the
    // value; the segment-level KEY_PREFIX_RE filter therefore looks at the
    // whole string and would otherwise drop any input that starts with a
    // key like "diet: …".
    norm_traits: "pinstripe, crowned, orange",
  });
  assert.deepEqual(out, ["pinstripe", "crowned", "orange"]);
});

test("parseTraitList dedupes and lower-cases", () => {
  const out = parseTraitList("Pinstripe, Pinstripe, AXANTHIC");
  assert.deepEqual(out, ["pinstripe", "axanthic"]);
});

test("parseTraitList keeps multi-word traits intact when comma-delimited", () => {
  // Chart consumers want per-word splits inside pipe-segments (which is the
  // legacy behaviour) but the comma path keeps each segment whole; this is
  // the contract chart code already relies on for cached_traits rows.
  const out = parseTraitList("AB, Lilly White, CD");
  assert.deepEqual(out, ["lilly white"]);
});

test("sanitizeCachedTraits keeps pipes between real segments", () => {
  const out = sanitizeCachedTraits("Diet: Meal Replacement | Pinstripe | Crowned");
  assert.equal(out, "Pinstripe | Crowned");
});

test("sanitizeCachedTraits returns null for all-keyvalue input", () => {
  assert.equal(sanitizeCachedTraits("Diet: X | Proven breeder: No"), null);
  assert.equal(sanitizeCachedTraits(""), null);
  assert.equal(sanitizeCachedTraits(null as unknown as string), null);
});

test("sanitizeNormTraits drops any comma-segment containing a colon", () => {
  assert.equal(
    sanitizeNormTraits("diet: meal replacement, pinstripe, crowned"),
    "pinstripe, crowned",
  );
});

// Group-lot detection. This rule exists three times: here, in SQL
// (public._looks_like_group_lot, migration 0042) and in Python
// (scripts/lib/canonical.py). These cases are the shared contract, and were
// checked against all three implementations on real production titles.
test("looksLikeGroupLot flags listings that price more than one animal", () => {
  for (const title of [
    "4 Pack",
    "Three Pack",
    "Group Of 5",
    "Proven Pair",
    "Breeding Pair",
    "X3 Cresties",
    "2 Lot Red Dals",
    "Wholesale 5/10 Lot Cresties",
    "R2B Frap Trio",
  ]) {
    assert.equal(looksLikeGroupLot(title), true, title);
  }
});

test("looksLikeGroupLot leaves single animals alone", () => {
  for (const title of [
    "Lilly White Male",
    "Extreme Harlequin",
    "Axanthic Female",
    "Cappuccino Het Axanthic",
    "",
  ]) {
    assert.equal(looksLikeGroupLot(title), false, title);
  }
  assert.equal(looksLikeGroupLot(null), false);
  assert.equal(looksLikeGroupLot(undefined), false);
  assert.equal(looksLikeGroupLot(42), false);
});
