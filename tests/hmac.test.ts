import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyHmac } from "../src/lib/ingest/hmac";

const SECRET = "test-secret-do-not-use-in-prod";

function sign(ts: number, body: string): string {
  return createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
}

test("verifyHmac accepts a valid recent signature", () => {
  const body = '{"events":[]}';
  const ts = Date.now();
  const v = verifyHmac({
    body,
    timestampHeader: String(ts),
    signatureHeader: sign(ts, body),
    required: true,
    secret: SECRET,
  });
  assert.equal(v.ok, true);
});

test("verifyHmac rejects a tampered body", () => {
  const ts = Date.now();
  const sig = sign(ts, '{"events":[]}');
  const v = verifyHmac({
    body: '{"events":[{"type":"listingSeen"}]}',
    timestampHeader: String(ts),
    signatureHeader: sig,
    required: true,
    secret: SECRET,
  });
  assert.equal(v.ok, false);
});

test("verifyHmac rejects out-of-skew timestamps", () => {
  const body = "x";
  const oldTs = Date.now() - 10 * 60 * 1000;
  const v = verifyHmac({
    body,
    timestampHeader: String(oldTs),
    signatureHeader: sign(oldTs, body),
    required: true,
    secret: SECRET,
  });
  assert.equal(v.ok, false);
});

test("verifyHmac falls back to bearer-only when headers absent and not required", () => {
  const v = verifyHmac({
    body: "anything",
    timestampHeader: null,
    signatureHeader: null,
    required: false,
    secret: SECRET,
  });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.mode, "bearer_only");
});

test("verifyHmac fails when required but headers absent", () => {
  const v = verifyHmac({
    body: "anything",
    timestampHeader: null,
    signatureHeader: null,
    required: true,
    secret: SECRET,
  });
  assert.equal(v.ok, false);
});
