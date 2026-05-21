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
