// Combo matcher tests. Pins the canonical set against the IDs that the
// public /data/market.json snapshot keys on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCombo, HIGH_VALUE_COMBOS } from "../src/lib/market/combos";

test("matchCombo finds Lilly White x Axanthic from a string trait list", () => {
  const m = matchCombo("Lilly White, Axanthic, Crowned");
  assert.equal(m?.id, "lw-axa");
});

test("matchCombo handles array input", () => {
  const m = matchCombo(["Cappuccino", "Full Pinstripe", "Tiger"]);
  assert.equal(m?.id, "cap-pin");
});

test("matchCombo is case + punctuation insensitive", () => {
  const m = matchCombo("cappuccino|super dalmatian");
  assert.equal(m?.id, "cap-dal");
});

test("matchCombo returns null when no combo matches", () => {
  assert.equal(matchCombo("Crowned, Soft Scale"), null);
});

test("matchCombo handles empty/garbage input gracefully", () => {
  assert.equal(matchCombo(null), null);
  assert.equal(matchCombo(undefined), null);
  assert.equal(matchCombo(""), null);
  assert.equal(matchCombo(42 as unknown as string), null);
});

test("HIGH_VALUE_COMBOS has unique ids", () => {
  const ids = new Set(HIGH_VALUE_COMBOS.map((c) => c.id));
  assert.equal(ids.size, HIGH_VALUE_COMBOS.length);
});

// Most rows in market_listings have null cached_traits/norm_traits; the
// route falls back to matching against the listing title. That input is
// whitespace-delimited, so the matcher must reconstruct multi-word traits
// like "Lilly White" from adjacent words.
test("matchCombo finds Lilly White x Axanthic from a whitespace title", () => {
  const m = matchCombo("Lilly White Axanthic Female - Crested Gecko");
  assert.equal(m?.id, "lw-axa");
});

test("matchCombo finds Cappuccino x Full Pinstripe from a title", () => {
  const m = matchCombo("Cappuccino Full Pinstripe Juvenile");
  assert.equal(m?.id, "cap-pin");
});

test("matchCombo from title still requires the 'Full' qualifier on Full Pinstripe", () => {
  // "Cappuccino Pinstripe" (without "Full") must NOT match cap-pin.
  const m = matchCombo("Cappuccino Pinstripe Tiger");
  assert.notEqual(m?.id, "cap-pin");
});

test("matchCombo finds Red Harlequin from a title", () => {
  const m = matchCombo("Red Harlequin Male Crested Gecko");
  assert.equal(m?.id, "red-harl");
});

test("matchCombo from title does not falsely match unrelated text", () => {
  // No combo traits present — must return null.
  assert.equal(matchCombo("Dark Tricolor Whitewall NPV"), null);
});
