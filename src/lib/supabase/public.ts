import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "./env";

// Cookie-free client for public, RLS-protected reads. Unlike the session
// client, this does not opt a Server Component into request-time rendering,
// so callers can safely put results behind Next's Data Cache.
export function createPublicClient() {
  const config = getPublicSupabaseEnv();
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

  return createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
