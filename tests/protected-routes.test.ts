import assert from "node:assert/strict";
import test from "node:test";
import { isProtectedPath } from "../src/lib/auth/protected-routes";
import { config } from "../src/middleware";

test("protects privileged pages without swallowing similarly named routes", () => {
  for (const path of [
    "/upload",
    "/upload/history",
    "/admin",
    "/admin/analytics",
    "/data-admin/runs",
  ]) {
    assert.equal(isProtectedPath(path), true, path);
  }

  for (const path of ["/", "/sold", "/sellers/abc", "/administrator"]) {
    assert.equal(isProtectedPath(path), false, path);
  }
});

test("middleware matcher is scoped away from public catalog routes", () => {
  assert.equal(config.matcher.some((matcher) => matcher.includes("/sold")), false);
  assert.equal(config.matcher.some((matcher) => matcher.includes("((?!")), false);
  assert.ok(config.matcher.includes("/upload/:path*"));
  assert.ok(config.matcher.includes("/api/alerts/:path*"));
});
