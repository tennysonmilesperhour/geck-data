// Server-only helper: parse a SQLite database file (as ArrayBuffer) using
// sql.js (a WASM build of SQLite). Returns the rows from the two tables
// we care about, as JS objects ready to upsert into Supabase.
import initSqlJs, { type SqlJsStatic, type Database } from "sql.js";
import type { SupabaseClient } from "@supabase/supabase-js";

let _sql: SqlJsStatic | null = null;

async function getSql(): Promise<SqlJsStatic> {
  if (_sql) return _sql;
  _sql = await initSqlJs({
    // Pull the wasm from the official jsDelivr CDN — avoids bundling it.
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/${file}`,
  });
  return _sql;
}

export type ParsedDb = {
  listings: Record<string, unknown>[];
  sellers: Record<string, unknown>[];
};

// Whitelisted tables that rowsFromTable is allowed to read. Sourced from
// the morphmarket SQLite export schema; any other identifier is rejected to
// keep a defence-in-depth boundary even though all current callers pass
// constants. This protects against any future caller threading user input
// through `table` and landing in the dynamic SQL below.
const ALLOWED_TABLES = new Set<string>([
  "morphmarket_listings",
  "morphmarket_sellers",
]);

function rowsFromTable(db: Database, table: string): Record<string, unknown>[] {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`rowsFromTable: table "${table}" is not in the allow list`);
  }
  // `table` is now guaranteed to be a constant from the allow list.
  const stmt = db.prepare(`SELECT * FROM ${table}`);
  const out: Record<string, unknown>[] = [];
  while (stmt.step()) {
    out.push(stmt.getAsObject());
  }
  stmt.free();
  return out;
}

export async function parseMorphmarketDb(buf: ArrayBuffer): Promise<ParsedDb> {
  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(buf));
  try {
    return {
      listings: rowsFromTable(db, "morphmarket_listings"),
      sellers: rowsFromTable(db, "morphmarket_sellers"),
    };
  } finally {
    db.close();
  }
}

// Generic batched upsert helper. Supabase accepts up to 1000 rows per call;
// we use 50 to keep failures small and progress visible.
export async function upsertBatched<T extends Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  rows: T[],
  pk: string,
  batchSize = 50,
): Promise<{ sent: number; errors: { batch: number; message: string }[] }> {
  let sent = 0;
  const errors: { batch: number; message: string }[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const { error } = await client.from(table).upsert(slice, { onConflict: pk });
    if (error) {
      errors.push({ batch: Math.floor(i / batchSize) + 1, message: error.message });
    } else {
      sent += slice.length;
    }
  }
  return { sent, errors };
}
