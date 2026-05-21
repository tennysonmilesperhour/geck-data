import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSynonym } from "../src/lib/market/synonyms";

test("resolveSynonym maps known alias", () => {
  const map = new Map([
    ["lily white", "Lilly White"],
    ["cappucino", "Cappuccino"],
  ]);
  assert.equal(resolveSynonym(map, "Lily White"), "Lilly White");
  assert.equal(resolveSynonym(map, "  CAPPUCINO  "), "Cappuccino");
});

test("resolveSynonym echoes unknown input", () => {
  const map = new Map([["lily white", "Lilly White"]]);
  assert.equal(resolveSynonym(map, "Axanthic"), "Axanthic");
});
