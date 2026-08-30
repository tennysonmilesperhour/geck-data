import assert from "node:assert/strict";
import test from "node:test";
import {
  comboPairKey,
  isRedundantComboName,
  redundantComboKeys,
} from "../src/lib/market/combo-redundancy";

test("comboPairKey treats x and multiplication sign as the same pair", () => {
  assert.equal(
    comboPairKey("Extreme Harlequin × Harlequin"),
    comboPairKey("Harlequin x Extreme Harlequin"),
  );
});

test("redundantComboKeys drops parent/child pairs from v_combo_breadth", () => {
  const keys = redundantComboKeys([
    { combo_id: "Extreme Harlequin x Harlequin", is_redundant_pair: true },
    { combo_id: "Lilly White x Cappuccino", is_redundant_pair: false },
  ]);
  assert.equal(isRedundantComboName("Extreme Harlequin × Harlequin", keys), true);
  assert.equal(isRedundantComboName("Lilly White × Cappuccino", keys), false);
});

test("isRedundantComboName is false when the breadth set is empty", () => {
  assert.equal(isRedundantComboName("Dalmatian x Super Dalmatian", new Set()), false);
});
