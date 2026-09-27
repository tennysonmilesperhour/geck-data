import { test } from "node:test";
import assert from "node:assert/strict";
import { comparableTraits, opportunities, pivot, vsUs } from "../src/lib/simple/markets";
import type { MarketCell, MarketCode } from "../src/lib/simple/data";

const cell = (market: MarketCode, trait: string | null, p50: number, n = 20): MarketCell => ({
  market,
  trait,
  n,
  p25: p50 * 0.7,
  p50,
  p75: p50 * 1.3,
  asOf: null,
});

// Shape of the real September 2026 numbers.
const GRID = pivot([
  cell("US", null, 300, 6500),
  cell("KR", null, 369, 2505),
  cell("US", "Sable", 975, 36),
  cell("KR", "Sable", 369, 316),
  cell("US", "Pinstripe", 200, 263),
  cell("KR", "Pinstripe", 517, 88),
  cell("US", "Axanthic", 950, 38),
  cell("KR", "Axanthic", 941, 254),
  cell("US", "Cappuccino", 400, 154),
  cell("KR", "Cappuccino", 221, 5), // too few Korean listings
  cell("EU", "Cappuccino", 194, 38),
]);

test("import picks morphs clearly cheaper abroad, after the export markup", () => {
  const imp = opportunities(GRID, "KR", "import", 1.05);
  assert.deepEqual(imp.map((o) => o.trait), ["Sable"]);
  assert.equal(imp[0].buy, Math.round(369 * 1.05));
  assert.equal(imp[0].room, 975 - Math.round(369 * 1.05));
});

test("export picks morphs clearly pricier abroad", () => {
  const exp = opportunities(GRID, "KR", "export");
  assert.deepEqual(exp.map((o) => o.trait), ["Pinstripe"]);
  assert.equal(exp[0].room, 317);
});

test("near-equal prices and thin samples are not opportunities", () => {
  const all = [...opportunities(GRID, "KR", "import", 1.05), ...opportunities(GRID, "KR", "export")];
  assert.ok(!all.some((o) => o.trait === "Axanthic"));
  assert.ok(!all.some((o) => o.trait === "Cappuccino"));
  assert.deepEqual(opportunities(GRID, "EU", "import").map((o) => o.trait), ["Cappuccino"]);
});

test("comparable traits need the US and one other market", () => {
  assert.deepEqual(new Set(comparableTraits(GRID)), new Set(["Sable", "Pinstripe", "Axanthic", "Cappuccino"]));
});

test("vsUs wording", () => {
  assert.deepEqual(vsUs(369, 975), { text: "62% less", dir: "below" });
  assert.deepEqual(vsUs(517, 200), { text: "2.6x", dir: "above" });
  assert.deepEqual(vsUs(310, 300), { text: "about the same", dir: "same" });
  assert.deepEqual(vsUs(360, 300), { text: "20% more", dir: "above" });
});
