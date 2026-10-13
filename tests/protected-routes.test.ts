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
    // Members only since 13 Oct 2026: single listings, photos and sellers.
    "/listings",
    "/listings/abc123",
    "/sellers",
    "/sellers/abc",
    "/design-lab/nocturne",
  ]) {
    assert.equal(isProtectedPath(path), true, path);
  }

  for (const path of ["/", "/sold", "/administrator", "/morphs/lilly-white", "/trends", "/listingsx", "/sellersville"]) {
    assert.equal(isProtectedPath(path), false, path);
  }
});

test("middleware matcher is scoped away from public catalog routes", () => {
  assert.equal(config.matcher.some((matcher) => matcher.includes("/sold")), false);
  assert.equal(config.matcher.some((matcher) => matcher.includes("((?!")), false);
  assert.ok(config.matcher.includes("/upload/:path*"));
  assert.ok(config.matcher.includes("/api/alerts/:path*"));
  for (const members of ["/listings/:path*", "/sellers/:path*", "/design-lab/:path*"]) {
    assert.ok(config.matcher.includes(members), members);
  }
  assert.equal(config.matcher.some((matcher) => matcher.startsWith("/morphs")), false);
});
