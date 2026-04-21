// Browser-side Supabase client. Uses the anon key — safe for the browser.
//
// Session persistence:
//   - Default: persistent cookies (session survives browser close). This is
//     what @supabase/ssr does out of the box.
//   - "Stay logged in" unchecked on the login form: we flip a flag in
//     sessionStorage before sign-in, and createClient() returns a client
//     whose session is stored in sessionStorage instead of the normal
//     persistent localStorage. sessionStorage is cleared when the tab
//     closes, giving the user "this session only".
"use client";
import { createBrowserClient } from "@supabase/ssr";

const SESSION_ONLY_FLAG = "geck_session_only_auth";

export function setSessionOnly(flag: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (flag) sessionStorage.setItem(SESSION_ONLY_FLAG, "1");
    else sessionStorage.removeItem(SESSION_ONLY_FLAG);
  } catch {
    // sessionStorage unavailable (private browsing lockdown) — fall back to
    // default persistent behavior silently.
  }
}

function isSessionOnly(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(SESSION_ONLY_FLAG) === "1";
  } catch {
    return false;
  }
}

export function createClient() {
  const sessionOnly = isSessionOnly();
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    sessionOnly
      ? {
          // Route the auth session through sessionStorage so it dies with
          // the tab. Supabase-JS accepts any Storage-shaped object.
          auth: {
            storage:
              typeof window !== "undefined"
                ? window.sessionStorage
                : undefined,
            persistSession: true,
            autoRefreshToken: true,
          },
        }
      : undefined,
  );
}
