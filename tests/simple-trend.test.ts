import { test } from "node:test";
import assert from "node:assert/strict";
import { fullRuns, priceChange, saleWeek, untracked } from "../src/lib/simple/trend";
import type { TrendWeek } from "../src/lib/simple/data";

const wk = (week: string, over: Partial<TrendWeek> = {}): TrendWeek => ({
  week,
  seen: 6000,
  p25: 150,
  p50: 300,
  p75: 450,
  cuts: 400,
  raises: 300,
  medianCut: 0.2,
  newListings: 600,
  cameDown: 700,
  afterGap: false,
  partial: false,
  ...over,
});

// Shape of the real history: a partial first week, four full weeks, a
// partial week, a ten-week outage, then a partial recheck.
const HISTORY = [
  wk("2026-05-04", { partial: true, afterGap: true, cuts: 0 }),
  wk("2026-05-11", { cuts: 403 }),
  wk("2026-05-18", { cuts: 1217, medianCut: 0.37 }),
  wk("2026-05-25", { cuts: 430, raises: 1001 }),
  wk("2026-06-01", { cuts: 402 }),
  wk("2026-06-08", { partial: true, seen: 125, cuts: 6 }),
  wk("2026-08-24", { partial: true, afterGap: true, seen: 414, cuts: 0 }),
];

test("lines join only back-to-back full weeks", () => {
  const runs = fullRuns(HISTORY);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].map((w) => w.week), ["2026-05-11", "2026-05-18", "2026-05-25", "2026-06-01"]);
});

test("a missing week splits a run instead of bridging it", () => {
  const runs = fullRuns([wk("2026-05-11"), wk("2026-05-18"), wk("2026-06-01"), wk("2026-06-08")]);
  assert.equal(runs.length, 2);
});

test("outages are reported as untracked stretches, not zero weeks", () => {
  const gaps = untracked(HISTORY);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].from, "2026-06-08");
  assert.equal(gaps[0].to, "2026-08-24");
  assert.equal(gaps[0].weeks, 10);
});

test("finds the Memorial Day sale week and the rebound after it", () => {
  const s = saleWeek(HISTORY);
  assert.ok(s);
  assert.equal(s.week, "2026-05-18");
  assert.equal(s.cuts, 1217);
  assert.equal(s.raisesNext, 1001);
});

test("normal churn is not called a sale", () => {
  assert.equal(saleWeek([wk("2026-05-11"), wk("2026-05-18", { cuts: 500 }), wk("2026-05-25")]), null);
  assert.equal(saleWeek([wk("2026-05-11")]), null);
});

test("price change compares first and last full weeks, ignoring partial ones", () => {
  const c = priceChange(HISTORY.map((w, i) => (i === 4 ? { ...w, p50: 330 } : w)));
  assert.ok(c);
  assert.equal(c.from.week, "2026-05-11");
  assert.equal(c.to.week, "2026-06-01");
  assert.ok(Math.abs(c.pct - 0.1) < 1e-9);
});
