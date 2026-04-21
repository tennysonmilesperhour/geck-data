// Service-role Supabase client. Bypasses RLS. NEVER import from client code.
// Only use inside Route Handlers or Server Actions that do admin writes.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  // Accept either naming convention: the Next.js-style NEXT_PUBLIC_* names used
  // locally, or the shorter SUPABASE_URL / SUPABASE_SERVICE_KEY used in Vercel.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin env vars not set. Expected SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
