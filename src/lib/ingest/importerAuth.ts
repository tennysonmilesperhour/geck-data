// Shared authorization helper for /api/import/* routes. Reuses INGEST_API_KEY
// so we don't have to manage a second secret. Constant-time compare.
import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export function isAuthorizedImporter(req: NextRequest): boolean {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  const fromBearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const fromApiKey = req.headers.get("x-api-key") ?? "";
  const presented = fromBearer || fromApiKey;
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
