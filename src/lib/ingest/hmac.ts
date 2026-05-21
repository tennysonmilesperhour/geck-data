// HMAC-SHA256 envelope verification for /api/ingest.
//
// Layered on top of the existing bearer token: a leaked token alone is no
// longer enough to write to production. Callers that opt in include:
//
//   X-Ingest-Timestamp: <unix ms>
//   X-Ingest-Signature: <hex sha256 hmac over `${ts}.${body}`>
//
// Both headers must be present; if either is missing we fall back to the
// bearer-only path so existing extension installs keep working. Once the
// extension v5 ships HMAC support, set INGEST_REQUIRE_HMAC=1 to require it.
//
// Skew window: 5 minutes. A signed request older than that is rejected even
// if the signature is valid — protects against replay of captured payloads.

import { createHmac, timingSafeEqual } from "node:crypto";

const SKEW_MS = 5 * 60 * 1000;

export type HmacCheck =
  | { ok: true; mode: "hmac" | "bearer_only" }
  | { ok: false; reason: string };

export function verifyHmac(opts: {
  body: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  required: boolean;
  secret: string | undefined;
}): HmacCheck {
  const hasHeaders = !!opts.timestampHeader && !!opts.signatureHeader;
  if (!hasHeaders) {
    if (opts.required) {
      return { ok: false, reason: "HMAC required but headers missing" };
    }
    return { ok: true, mode: "bearer_only" };
  }
  if (!opts.secret) {
    // Required headers present but server has no secret configured —
    // surface that loud, because silent fallback would be confusing.
    return { ok: false, reason: "INGEST_HMAC_SECRET not configured" };
  }

  const ts = Number(opts.timestampHeader);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "X-Ingest-Timestamp not a number" };
  }
  const skew = Math.abs(Date.now() - ts);
  if (skew > SKEW_MS) {
    return { ok: false, reason: `timestamp skew ${skew}ms > ${SKEW_MS}ms` };
  }

  const expected = createHmac("sha256", opts.secret)
    .update(`${ts}.${opts.body}`)
    .digest("hex");
  const a = Buffer.from(opts.signatureHeader!.toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return { ok: false, reason: "signature length mismatch" };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true, mode: "hmac" };
}
