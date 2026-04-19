// Extension ingest endpoint.
// POST https://geck-data.vercel.app/api/ingest
//
// Auth: `Authorization: Bearer <INGEST_API_KEY>` (also accepts `x-api-key`).
// Body: { kind: "animal" | "sold" | "listings" | "sellers", items: object[], source?: string }
//
// Writes to `market_listings` (animal/sold/listings) or `market_sellers`
// (sellers) using the service-role key, plus appends a row to `ingest_events`
// for every request so failures are debuggable from the database.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertBatched } from "@/lib/ingest/parseSqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Kind = "animal" | "sold" | "listings" | "sellers";

type IngestBody = {
  kind: Kind;
  items: Record<string, unknown>[];
  source?: string;
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-api-key, x-ingest-source",
};

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return false;
  const header =
    req.headers.get("authorization") ?? req.headers.get("x-api-key") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : header;
  return presented === expected;
}

function pickListingId(item: Record<string, unknown>): string | null {
  const candidates = ["id", "listing_id", "slug", "uuid"];
  for (const key of candidates) {
    const v = item[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function pickSellerId(item: Record<string, unknown>): string | null {
  const candidates = ["seller_id", "id", "username", "slug"];
  for (const key of candidates) {
    const v = item[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function normalizeListing(
  raw: Record<string, unknown>,
  kind: Kind,
): Record<string, unknown> | null {
  const id = pickListingId(raw);
  if (!id) return null;
  return {
    id,
    kind, // "animal" | "sold" | "listings"
    raw,
    updated_at: new Date().toISOString(),
  };
}

function normalizeSeller(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const id = pickSellerId(raw);
  if (!id) return null;
  return {
    seller_id: id,
    raw,
    updated_at: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return json({ error: "invalid json body" }, { status: 400 });
  }

  const kind = body.kind;
  const items = Array.isArray(body.items) ? body.items : [];
  if (!kind || !["animal", "sold", "listings", "sellers"].includes(kind)) {
    return json(
      { error: "kind must be one of animal|sold|listings|sellers" },
      { status: 400 },
    );
  }
  if (items.length === 0) {
    return json({ ok: true, kind, received: 0, written: 0 });
  }

  const admin = createAdminClient();
  const source =
    body.source ?? req.headers.get("x-ingest-source") ?? "extension";

  let written = 0;
  let errors: { batch: number; message: string }[] = [];
  let skipped = 0;

  if (kind === "sellers") {
    const rows = items
      .map(normalizeSeller)
      .filter((r): r is Record<string, unknown> => r !== null);
    skipped = items.length - rows.length;
    const result = await upsertBatched(admin, "market_sellers", rows, "seller_id");
    written = result.sent;
    errors = result.errors;
  } else {
    const rows = items
      .map((it) => normalizeListing(it, kind))
      .filter((r): r is Record<string, unknown> => r !== null);
    skipped = items.length - rows.length;
    const result = await upsertBatched(admin, "market_listings", rows, "id");
    written = result.sent;
    errors = result.errors;
  }

  // Fire-and-forget log. Don't block the response on log failures.
  admin
    .from("ingest_events")
    .insert({
      kind,
      source,
      received: items.length,
      written,
      skipped,
      errors: errors.length > 0 ? errors : null,
    })
    .then(() => {});

  return json({
    ok: errors.length === 0,
    kind,
    received: items.length,
    written,
    skipped,
    errors,
  });
}
