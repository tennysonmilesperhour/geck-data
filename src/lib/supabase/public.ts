import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "./env";

// Cookie-free server client for page data. Unlike the session client, this
// does not opt a Server Component into request-time rendering, so callers can
// safely put results behind Next's Data Cache.
//
// Since 13 Oct 2026 the listing-level tables are closed to the public key
// (single listings and sellers are members-only), so on the server this uses
// the service key when it is set. This file is server-only; the key never
// reaches a browser. Pages decide what to show: public pages render
// aggregates, /listings and /sellers sit behind the members gate.
export function createPublicClient() {
  const config = getPublicSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!config) {
    throw new Error(
      "Supabase public env vars not set. Expected a Supabase URL and publishable (or anon) key.",
    );
  }

  try {
    new URL(config.url);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL is not a valid URL. Got: ${JSON.stringify(config.url)}`,
    );
  }

  return createClient(config.url, serviceKey ?? config.key, {
    db: { schema: config.schema },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
