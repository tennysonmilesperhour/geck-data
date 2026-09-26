import { test } from "node:test";
import assert from "node:assert/strict";
import { estimate, gridKey, type ValueGrid } from "../src/lib/simple/estimate";

const cell = (n: number, p25: number, p50: number, p75: number) => ({ n, p25, p50, p75 });

test("uses the exact age x sex cell when it has enough listings", () => {
  const grid: ValueGrid = new Map([
    [gridKey("adult", "female"), cell(10, 400, 600, 800)],
    [gridKey("any", "any"), cell(100, 300, 450, 700)],
  ]);
  const e = estimate(grid, new Map(), "adult", "female");
  assert.equal(e?.basis, "exact");
  assert.equal(e?.mid, 600);
});

test("falls back to morph overall scaled by the market age x sex ratio", () => {
  const grid: ValueGrid = new Map([
    [gridKey("hatchling", "female"), cell(2, 500, 750, 1000)],
    [gridKey("any", "any"), cell(100, 300, 400, 600)],
  ]);
  const market: ValueGrid = new Map([
    [gridKey("hatchling", "female"), cell(140, 150, 250, 500)],
    [gridKey("any", "any"), cell(9000, 150, 280, 450)],
  ]);
  const e = estimate(grid, market, "hatchling", "female");
  assert.equal(e?.basis, "adjusted");
  // 400 * 250/280 = 357.1, rounded to the nearest 5
  assert.equal(e?.mid, 355);
});

test("returns null when even the morph overall is too thin", () => {
  const grid: ValueGrid = new Map([[gridKey("any", "any"), cell(3, 100, 200, 300)]]);
  assert.equal(estimate(grid, new Map(), null, null), null);
});

test("no age or sex picked means the morph-only band", () => {
  const grid: ValueGrid = new Map([[gridKey("any", "any"), cell(50, 200, 300, 450)]]);
  assert.equal(estimate(grid, new Map(), null, null)?.basis, "morph-only");
});
