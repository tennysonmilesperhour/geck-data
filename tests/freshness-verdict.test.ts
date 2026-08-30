import assert from "node:assert/strict";
import test from "node:test";
import {
  marketFeedVerdict,
  type MarketCoverage,
} from "../src/lib/market/feed-verdict";

// A fixed "now" so these assertions do not drift. It is the afternoon of the
// day the audit fixes landed, which is also the day of the last ingest.
const NOW = Date.parse("2026-08-29T18:00:00Z");

function coverage(over: Partial<MarketCoverage> = {}): MarketCoverage {
  return {
    totalLive: 10158,
    freshLive: 565,
    staleLive: 9274,
    coveragePct: 5.6,
    cycleCoveragePct: 5.6,
    newestObservationAt: "2026-08-29T15:04:38Z",
    observationAgeHours: 2.8,
    lastCompletePassAt: "2026-08-29T15:04:38Z",
    observedDays30: 3,
    observedDays90: 13,
    newestSoldAt: "2026-06-07T10:11:28Z",
    soldAgeDays: 83.3,
    capturedSoldEvents: 92,
    inferredSoldRecords: 2849,
    freshHours: 48,
    cycleHours: 192,
    ...over,
  };
}

test("a recent narrow production batch reads limited rather than stale", () => {
  const v = marketFeedVerdict(coverage(), NOW);
  assert.equal(v.level, "limited");
  assert.equal(v.headline, "Limited catalog coverage");
  assert.match(v.detail, /5\.6% of 10,158/);
  assert.doesNotMatch(v.detail, /recorded sale/i);
});

test("a fresh batch on top of an unobserved catalogue does not read as healthy", () => {
  // This is the exact failure the old max(last_seen_at) rule had: the newest
  // observation is minutes old, so the banner stayed silent while 91% of the
  // catalogue had not been looked at in months.
  const v = marketFeedVerdict(
    coverage({ newestObservationAt: "2026-08-29T17:59:00Z", observationAgeHours: 0.02 }),
    NOW,
  );
  assert.notEqual(v.level, "ok");
});

test("a healthy weekly pulse reads ok even midweek", () => {
  // The other half of the old rule's failure: a perfectly good Monday pass is
  // three days old by Thursday, which a 48h recency rule calls an outage.
  const thursday = Date.parse("2026-09-03T12:00:00Z");
  const v = marketFeedVerdict(
    coverage({
      coveragePct: 0,
      cycleCoveragePct: 92,
      lastCompletePassAt: "2026-08-31T15:00:00Z",
      newestObservationAt: "2026-08-31T15:00:00Z",
      newestSoldAt: "2026-08-30T00:00:00Z",
      soldAgeDays: 4,
    }),
    thursday,
  );
  assert.equal(v.level, "ok");
  assert.equal(v.headline, "Coverage current");
});

test("partial coverage is its own level, between current and stale", () => {
  const v = marketFeedVerdict(coverage({ cycleCoveragePct: 55 }), NOW);
  assert.equal(v.level, "partial");
  assert.equal(v.headline, "Partial coverage");
});

test("limited coverage is distinct from an overdue pass", () => {
  const v = marketFeedVerdict(coverage({ cycleCoveragePct: 12 }), NOW);
  assert.equal(v.level, "limited");
  assert.equal(v.headline, "Limited catalog coverage");
});

test("a pass older than one cycle is stale whatever it covered", () => {
  const v = marketFeedVerdict(
    coverage({
      cycleCoveragePct: 99,
      lastCompletePassAt: "2026-08-01T00:00:00Z",
      newestObservationAt: "2026-08-01T00:00:00Z",
    }),
    NOW,
  );
  assert.equal(v.level, "stale");
  assert.equal(v.headline, "No recent pass");
});

test("a failed coverage read says so rather than guessing", () => {
  const v = marketFeedVerdict(null, NOW);
  assert.equal(v.level, "unknown");
  assert.match(v.detail, /cannot say/);
});
