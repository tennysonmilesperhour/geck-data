// Machine-to-machine ingest endpoint for the browser extension.
// Auth: Authorization: Bearer <INGEST_API_KEY> (constant-time compared).
// Body: multipart/form-data with one or more files in the "files" field.
// Routing matches /api/upload: .db -> SQLite parse, image/* -> listing-images,
// .csv -> raw-uploads archive. Writes use the service role key.
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseMorphmarketDb, upsertBatched } from "@/lib/ingest/parseSqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ResultEntry = {
  file: string;
  kind: "db" | "image" | "csv" | "unknown";
  ok: boolean;
  detail: string;
};

function classify(name: string, mime: string): ResultEntry["kind"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".db") || lower.endsWith(".sqlite")) return "db";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "csv";
  if (mime.startsWith("image/")) return "image";
  return "unknown";
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/ingest] fatal:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `invalid multipart body: ${msg}` },
      { status: 400 },
    );
  }
  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no files uploaded" }, { status: 400 });
  }

  const admin = createAdminClient();
  const results: ResultEntry[] = [];

  for (const file of files) {
    const kind = classify(file.name, file.type);
    try {
      if (kind === "db") {
        const buf = await file.arrayBuffer();
        const parsed = await parseMorphmarketDb(buf);
        const lUp = await upsertBatched(admin, "market_listings", parsed.listings, "id");
        const sUp = await upsertBatched(admin, "market_sellers", parsed.sellers, "seller_id");
        const failed = lUp.errors.length + sUp.errors.length;
        results.push({
          file: file.name,
          kind,
          ok: failed === 0,
          detail: `listings: ${lUp.sent}/${parsed.listings.length}, sellers: ${sUp.sent}/${parsed.sellers.length}${failed ? ` — ${failed} failed batches` : ""}`,
        });
      } else if (kind === "image") {
        const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await admin.storage
          .from("listing-images")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const m = file.name.match(/(mm_\d+)/);
        const listingId = m ? m[1] : null;
        const { error: insErr } = await admin.from("listing_images").insert({
          listing_id: listingId,
          storage_bucket: "listing-images",
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: null,
        });
        if (insErr) throw insErr;
        results.push({
          file: file.name,
          kind,
          ok: true,
          detail: `stored at listing-images/${path}${listingId ? `, linked to ${listingId}` : ""}`,
        });
      } else if (kind === "csv") {
        const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await admin.storage
          .from("raw-uploads")
          .upload(path, file, { contentType: file.type || "text/csv" });
        if (upErr) throw upErr;
        results.push({
          file: file.name,
          kind,
          ok: true,
          detail: `archived to raw-uploads/${path}`,
        });
      } else {
        results.push({
          file: file.name,
          kind,
          ok: false,
          detail: `unrecognized file type (${file.type || "no mime"})`,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ file: file.name, kind, ok: false, detail: msg });
    }
  }

  return NextResponse.json({ results });
}
