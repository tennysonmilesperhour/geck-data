import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeReportKey,
  parseReportState,
  reportApiPath,
  reportHref,
  stateFromReportPath,
} from "../src/lib/simple/report-state";

test("parseReportState keeps valid traits and drops the rest", () => {
  const s = parseReportState({
    t: "Lilly-White, cappuccino, nope!, axanthic",
    sex: "female",
    age: "nope",
  });
  assert.deepEqual(s, {
    slugs: ["lilly-white", "cappuccino", "axanthic"],
    sex: "female",
    age: null,
  });
});

test("report links round-trip through the cached path", () => {
  const s = parseReportState({ t: "cappuccino,lilly-white", sex: "male", age: "adult" });
  assert.equal(reportHref(s), "/?t=cappuccino,lilly-white&sex=male&age=adult");
  assert.equal(reportApiPath(s), "/api/value-report/cappuccino,lilly-white/male/adult");
  assert.equal(encodeReportKey(s), encodeReportKey(stateFromReportPath("cappuccino,lilly-white", "male", "adult")));
  assert.equal(encodeReportKey(s), "cappuccino,lilly-white|male|adult");
});

test("an empty report is the bare homepage and the all-any path", () => {
  const s = parseReportState({});
  assert.equal(reportHref(s), "/");
  assert.equal(reportApiPath(s), "/api/value-report/-/-/-");
  assert.equal(encodeReportKey(s), "||");
});
