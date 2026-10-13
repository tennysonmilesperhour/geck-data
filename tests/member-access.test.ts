import assert from "node:assert/strict";
import test from "node:test";
import { isMemberRequest, MEMBERS_ONLY_BODY } from "../src/lib/auth/member";

test("a signed-out request with no cookie or token is not a member", async () => {
  assert.equal(await isMemberRequest(new Request("https://x.test/data/market.json")), false);
  const crawler = new Request("https://x.test/data/market.json", {
    headers: { "user-agent": "GPTBot/1.0", cookie: "theme=dark" },
  });
  assert.equal(await isMemberRequest(crawler), false);
});

test("a configured machine token is a member; a wrong one is not", async () => {
  const before = process.env.MEMBER_API_TOKEN;
  process.env.MEMBER_API_TOKEN = "member-test-token";
  try {
    const ok = new Request("https://x.test/data/market.json", {
      headers: { authorization: "Bearer member-test-token" },
    });
    assert.equal(await isMemberRequest(ok), true);
  } finally {
    if (before === undefined) delete process.env.MEMBER_API_TOKEN;
    else process.env.MEMBER_API_TOKEN = before;
  }
});

test("the members-only message points to public aggregates", () => {
  assert.equal(MEMBERS_ONLY_BODY.error, "members_only");
  assert.match(MEMBERS_ONLY_BODY.message, /Aggregate prices are public/);
});
