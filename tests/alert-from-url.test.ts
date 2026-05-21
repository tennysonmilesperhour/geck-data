import { test } from "node:test";
import assert from "node:assert/strict";
import { _internal } from "../src/app/api/alerts/from-url/route";

const { queryFromUrl } = _internal;

test("queryFromUrl maps combo id to trait_all", () => {
  const q = queryFromUrl("/market?combo=lw-axa");
  assert.deepEqual(q.trait_all, ["Lilly White", "Axanthic"]);
});

test("queryFromUrl extracts price band", () => {
  const q = queryFromUrl("/sellers?min_price=100&max_price=500");
  assert.equal(q.min_price, 100);
  assert.equal(q.max_price, 500);
});

test("queryFromUrl extracts regions + seller", () => {
  const q = queryFromUrl("?regions=US,UK&seller=s_42");
  assert.deepEqual(q.regions, ["US", "UK"]);
  assert.deepEqual(q.seller_ids, ["s_42"]);
});

test("queryFromUrl honours must_be_drop=1", () => {
  const q = queryFromUrl("?must_be_drop=1");
  assert.equal(q.must_be_drop, true);
});

test("queryFromUrl accepts bare query string", () => {
  const q = queryFromUrl("combo=cap-pin&min_price=300");
  assert.deepEqual(q.trait_all, ["Cappuccino", "Full Pinstripe"]);
  assert.equal(q.min_price, 300);
});

test("queryFromUrl returns empty for unrecognised params", () => {
  const q = queryFromUrl("/x?irrelevant=1&other=2");
  assert.deepEqual(q, {});
});
