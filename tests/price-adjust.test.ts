import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyToBand,
  combinedMultiplier,
  weightBucket,
  type MultiplierMap,
} from "../src/lib/market/price-adjust";

const M: MultiplierMap = {
  age: {
    hatchling: 0.55,
    juvenile: 0.75,
    subadult: 1.0,
    adult: 1.2,
    proven_breeder: 1.4,
    unknown: 1.0,
  },
  sex: { female: 1.15, male: 1.0, unknown: 1.0 },
  proven: { true: 1.1, false: 1.0 },
  weight_bucket: { underweight: 0.85, normal: 1.0, heavy: 1.05 },
};

test("weightBucket adult thresholds", () => {
  assert.equal(weightBucket(30, "adult"), "underweight");
  assert.equal(weightBucket(45, "adult"), "normal");
  assert.equal(weightBucket(65, "adult"), "heavy");
});

test("weightBucket subadult thresholds", () => {
  assert.equal(weightBucket(15, "subadult"), "underweight");
  assert.equal(weightBucket(25, "subadult"), "normal");
  assert.equal(weightBucket(42, "subadult"), "heavy");
});

test("weightBucket unknown age never penalises", () => {
  assert.equal(weightBucket(1, "unknown"), "normal");
  assert.equal(weightBucket(100, "unknown"), "normal");
});

test("combinedMultiplier compounds independent factors", () => {
  // proven adult female, 45g (normal weight for adult)
  const { total, applied } = combinedMultiplier(
    { age: "adult", sex: "female", weight_grams: 45, proven: true },
    M,
  );
  // 1.2 * 1.15 * 1.1 * 1.0 = 1.518
  assert.equal(applied.age, 1.2);
  assert.equal(applied.sex, 1.15);
  assert.equal(applied.proven, 1.1);
  assert.equal(applied.weight_bucket, 1.0);
  assert.equal(total, 1.518);
});

test("combinedMultiplier defaults unknown attributes to 1.0", () => {
  const { total } = combinedMultiplier({}, M);
  assert.equal(total, 1);
});

test("combinedMultiplier underweight adult drops the band", () => {
  const { total, applied } = combinedMultiplier(
    { age: "adult", sex: "male", weight_grams: 28, proven: false },
    M,
  );
  // 1.2 * 1.0 * 1.0 * 0.85 = 1.02
  assert.equal(applied.weight_bucket, 0.85);
  assert.equal(total, 1.02);
});

test("applyToBand scales each percentile and rounds", () => {
  const out = applyToBand({ p10: 100, p25: 150, p50: 200, p75: 300, p90: 500 }, 1.2);
  assert.deepEqual(out, { p10: 120, p25: 180, p50: 240, p75: 360, p90: 600 });
});

test("applyToBand preserves null cells", () => {
  const out = applyToBand({ p10: 100, p25: null, p50: 200 }, 1.5);
  assert.equal(out.p25, null);
  assert.equal(out.p10, 150);
  assert.equal(out.p50, 300);
});

test("proven_breeder age plus proven=true stacks", () => {
  // The point of having both age=proven_breeder AND proven=true is that
  // a young proven breeder (age=adult but proven=true) still picks up the
  // proven bonus. When both are set, both fire.
  const { total } = combinedMultiplier(
    { age: "proven_breeder", sex: "female", proven: true },
    M,
  );
  // 1.4 * 1.15 * 1.1 * 1.0 = 1.771
  assert.equal(total, 1.771);
});
