import assert from "node:assert/strict";
import test from "node:test";
import type { SoldRow } from "../src/components/sold/SortableSoldTable";
import { applySoldFilters, normaliseMaturity } from "../src/lib/sold/filters";

const rows = [
  {
    id: "one",
    title: "Lilly White female",
    maturity: "juvenile",
    sex: "Female",
  },
  {
    id: "two",
    title: "Axanthic male",
    maturity: "adult",
    sex: "male",
  },
].map(
  (row): SoldRow => ({
    seller_id: null,
    price: null,
    price_usd_equivalent: null,
    first_seen_at: null,
    sold_at: null,
    days_to_sell: null,
    sold_source: null,
    ...row,
  }),
);

test("applies shareable sold-page filters case-insensitively", () => {
  assert.deepEqual(
    applySoldFilters(rows, {
      morph: "lilly white",
      maturity: "Juvenile",
      sex: "female",
    }).map((row) => row.id),
    ["one"],
  );
});

// Baby was silently folded into "Unknown" while being the second most common
// age class in the sold pool, so the /sold Baby chip could never match a row.
// These cases pin every value MorphMarket actually emits.
test("normaliseMaturity maps every value MorphMarket emits", () => {
  assert.equal(normaliseMaturity("Baby"), "Baby");
  assert.equal(normaliseMaturity("baby"), "Baby");
  assert.equal(normaliseMaturity("Hatchling"), "Baby");
  assert.equal(normaliseMaturity("Juvenile"), "Juvenile");
  assert.equal(normaliseMaturity("Subadult"), "Subadult");
  assert.equal(normaliseMaturity("Adult"), "Adult");
  // Not an age class: a seller saying the animal is not for sale yet.
  assert.equal(normaliseMaturity("Not Ready"), "Not ready");
});

test("normaliseMaturity reports absence rather than guessing", () => {
  assert.equal(normaliseMaturity(null), "Unknown");
  assert.equal(normaliseMaturity(undefined), "Unknown");
  assert.equal(normaliseMaturity(""), "Unknown");
  assert.equal(normaliseMaturity("something else"), "Unknown");
});
