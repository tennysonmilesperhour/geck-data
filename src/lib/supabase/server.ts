// Server-side Supabase client that reads/writes the auth cookie.
// Use this in Server Components and Route Handlers when you need the
// current user's session (e.g., checking who's logged in).
//
// Accepts either naming convention (NEXT_PUBLIC_* locally, unprefixed on
// Vercel) and throws a descriptive error if the URL is missing or malformed
// so failures surface cleanly instead of a cryptic fetch trace.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase public env vars not set. Expected NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY).",
    );
  }
  try {
    new URL(url);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL is not a valid URL. Got: ${JSON.stringify(url)}`,
    );
  }

  const cookieStore = cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // setAll was called from a Server Component — safe to ignore
          // when a middleware refresh is in place.
        }
      },
    },
  });
}
