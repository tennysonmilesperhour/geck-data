import assert from "node:assert/strict";
import test from "node:test";
import { matchesApiToken } from "../src/lib/auth/tokens";

test("matches a configured API token", () => {
  assert.equal(matchesApiToken("ops-key", [undefined, "ops-key"]), true);
});

test("rejects empty, different, and length-mismatched API tokens", () => {
  assert.equal(matchesApiToken("", ["ops-key"]), false);
  assert.equal(matchesApiToken("wrong!!", ["ops-key"]), false);
  assert.equal(matchesApiToken("short", ["much-longer-key"]), false);
  assert.equal(matchesApiToken("anything", [undefined, ""]), false);
});
