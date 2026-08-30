import assert from "node:assert/strict";
import test from "node:test";
import { sectionVisibleFromCount } from "../src/lib/market/feed-verdict";

test("section gate hides a zero count", () => {
  assert.equal(sectionVisibleFromCount(0, false), false);
});

test("section gate shows a positive count", () => {
  assert.equal(sectionVisibleFromCount(12, false), true);
});

test("section gate fails open when the count cannot be read", () => {
  assert.equal(sectionVisibleFromCount(null, true), true);
  assert.equal(sectionVisibleFromCount(0, true), true);
});
