// Service-role Supabase client. Bypasses RLS. NEVER import from client code.
// Only use inside Route Handlers or Server Actions that do admin writes.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  // Accept either the Next.js-style names (NEXT_PUBLIC_SUPABASE_URL /
  // SUPABASE_SERVICE_ROLE_KEY) or the shorter names often configured on
  // Vercel (SUPABASE_URL / SUPABASE_SERVICE_KEY).
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin env vars missing. Set SUPABASE_URL + SUPABASE_SERVICE_KEY (or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
