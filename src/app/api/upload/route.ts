// Server-side upload handler. Accepts one or more files in a multipart form.
// Routes each file by extension:
//   *.db    -> parse SQLite, upsert into market_listings/market_sellers
//   *.csv   -> archive into the 'raw-uploads' storage bucket
//   image/* -> save to 'listing-images' bucket + insert a row in listing_images
//
// Auth: middleware already blocks unauthenticated users from /api/upload.
// Writes use the service role key so they bypass RLS.
import { NextRequest, NextResponse } from "next/server";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseMorphmarketDb, upsertBatched } from "@/lib/ingest/parseSqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — generous for sql.js parse

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

export async function POST(req: NextRequest) {
  // Double-check the session (middleware already gated us, but be explicit).
  const session = createSessionClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const form = await req.formData();
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
        // Attempt to extract a listing id from the filename
        // (e.g. "mm_3631595.jpg" -> listing_id "mm_3631595").
        const m = file.name.match(/(mm_\d+)/);
        const listingId = m ? m[1] : null;
        const { error: insErr } = await admin.from("listing_images").insert({
          listing_id: listingId,
          storage_bucket: "listing-images",
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: user.id,
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
