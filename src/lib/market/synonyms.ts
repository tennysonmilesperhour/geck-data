// In-process taxonomy synonym map.
//
// Loaded lazily from morph_taxonomy_synonyms (migration 0032) on first use
// and cached for the lifetime of the Lambda/edge instance. Refreshing
// requires a redeploy or a TTL — for now we accept stale aliases until the
// next cold start (the table is human-curated and changes rarely).
//
// Callers feed in a trait token (any casing); the resolver returns the
// canonical form or echoes the input back when nothing maps.
//
// Service-role only because we read from a public table without a session;
// no PII, no privilege leak.
import type { SupabaseClient } from "@supabase/supabase-js";

let cache: Map<string, string> | null = null;
let cachedAt = 0;
const TTL_MS = 5 * 60 * 1000; // 5 min, balances staleness vs cold-start cost

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export async function loadSynonymsOnce(admin: SupabaseClient): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cachedAt < TTL_MS) return cache;
  const { data, error } = await admin
    .from("morph_taxonomy_synonyms")
    .select("alias, canonical");
  if (error) {
    // Don't crash the caller if the table is missing; just return empty.
    cache = new Map();
    cachedAt = now;
    return cache;
  }
  const next = new Map<string, string>();
  for (const row of (data ?? []) as { alias: string; canonical: string }[]) {
    next.set(norm(row.alias), row.canonical);
  }
  cache = next;
  cachedAt = now;
  return cache;
}

/** Resolve a single trait token to its canonical form. Returns the input
 *  unchanged when no synonym is known. Case-insensitive. */
export function resolveSynonym(map: Map<string, string>, input: string): string {
  const hit = map.get(norm(input));
  return hit ?? input;
}

/** Test hook: drop the cache so the next loadSynonymsOnce() round-trips. */
export function _resetSynonymCache(): void {
  cache = null;
  cachedAt = 0;
}
