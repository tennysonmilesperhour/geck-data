import assert from "node:assert/strict";
import test from "node:test";
import { formatChartValue } from "../src/components/charts/TimeSeriesLine";

test("formats chart values from a serializable format name", () => {
  assert.equal(formatChartValue(1234.4, "number"), "1,234");
  assert.equal(formatChartValue(1234.6, "currency"), "$1,235");
});
