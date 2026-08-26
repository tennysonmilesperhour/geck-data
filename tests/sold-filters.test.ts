import assert from "node:assert/strict";
import test from "node:test";
import type { SoldRow } from "../src/components/sold/SortableSoldTable";
import { applySoldFilters } from "../src/lib/sold/filters";

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
