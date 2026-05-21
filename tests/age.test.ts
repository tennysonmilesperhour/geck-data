import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAge } from "../src/lib/market/age";

test("classifyAge maturity field beats weight", () => {
  assert.equal(classifyAge({ maturity: "Hatchling", weight: 50 }), "hatchling");
  assert.equal(classifyAge({ maturity: "Proven Breeder" }), "proven_breeder");
});

test("classifyAge falls back to weight buckets", () => {
  assert.equal(classifyAge({ weight: 2 }), "hatchling");
  assert.equal(classifyAge({ weight: 10 }), "juvenile");
  assert.equal(classifyAge({ weight: 25 }), "subadult");
  assert.equal(classifyAge({ weight: 50 }), "adult");
});

test("classifyAge parses weight strings with units", () => {
  assert.equal(classifyAge({ weight: "12g" }), "juvenile");
  assert.equal(classifyAge({ weight: "45 grams" }), "adult");
});

test("classifyAge falls back to hatch_date", () => {
  const oneMonthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  assert.equal(classifyAge({ hatch_date: oneMonthAgo }), "hatchling");
});

test("classifyAge returns unknown when nothing is available", () => {
  assert.equal(classifyAge({}), "unknown");
});

test("classifyAge honours is_breeding flag", () => {
  assert.equal(classifyAge({ is_breeding: true, maturity: "Juvenile" }), "proven_breeder");
});
