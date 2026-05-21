import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLineage } from "../src/lib/market/lineage";

test("classifyLineage foundational requires all three signals", () => {
  assert.equal(
    classifyLineage({
      feedback_count: 800,
      seller_rating_score: 4.9,
      total_listings: 50,
    }),
    "foundational",
  );
  // Drop any one signal → degrade to proven_breeder.
  assert.notEqual(
    classifyLineage({
      feedback_count: 800,
      seller_rating_score: 4.9,
      total_listings: 20,
    }),
    "foundational",
  );
});

test("classifyLineage sponsor membership unlocks proven_breeder", () => {
  assert.equal(
    classifyLineage({
      membership: "Sponsor",
      sold_in_window: 8,
      feedback_count: 5,
    }),
    "proven_breeder",
  );
});

test("classifyLineage emerging vs unknown", () => {
  assert.equal(classifyLineage({ total_listings: 2 }), "emerging");
  assert.equal(classifyLineage({}), "unknown");
});

test("classifyLineage regional_known threshold", () => {
  assert.equal(classifyLineage({ feedback_count: 50 }), "regional_known");
  assert.equal(
    classifyLineage({ total_listings: 15, seller_rating_score: 4.2 }),
    "regional_known",
  );
});
