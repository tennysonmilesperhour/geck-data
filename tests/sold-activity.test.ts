import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateSoldEvents,
  normaliseSoldActivity,
} from "../src/lib/sold/activity";

test("aggregates sold events into UTC Monday buckets", () => {
  assert.deepEqual(
    aggregateSoldEvents([
      { observed_at: "2026-08-23T23:59:59Z" },
      { observed_at: "2026-08-24T00:00:00Z" },
      { observed_at: "2026-08-25T12:00:00Z" },
      { observed_at: "not-a-date" },
    ]),
    [
      { week_start: "2026-08-17", sold_count: 1 },
      { week_start: "2026-08-24", sold_count: 2 },
    ],
  );
});

test("normalises bigint RPC values and drops malformed rows", () => {
  assert.deepEqual(
    normaliseSoldActivity([
      { week_start: "2026-08-17", sold_count: "42" },
      { week_start: "bad", sold_count: 5 },
      { week_start: "2026-08-24", sold_count: "NaN" },
    ]),
    [{ week_start: "2026-08-17", sold_count: 42 }],
  );
});
