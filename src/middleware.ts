// Runs only on routes that need a Supabase session. Two jobs:
//   1) Keep the user's Supabase session cookie fresh
//   2) Gate privileged pages to logged-in users (sends others to /login)
//
// If the Supabase env vars are missing or malformed, we pass the request
// through instead of 500'ing MIDDLEWARE_INVOCATION_FAILED. Protected APIs
// and admin layouts also enforce auth server-side.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isProtectedPath } from "@/lib/auth/protected-routes";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const config = getPublicSupabaseEnv();

  const pathname = request.nextUrl.pathname;
  const isProtected = isProtectedPath(pathname);

  if (!config) {
    // No Supabase config visible to the edge runtime. We can't refresh the
    // session cookie or enforce the gate; fall back to letting the request
    // through so the public routes still render. Protected pages must
    // enforce auth themselves.
    console.warn("[middleware] Supabase public env not set — passing through");
    return response;
  }

  // Quick URL validation to avoid a cryptic fetch failure deeper in the stack.
  try {
    new URL(config.url);
  } catch {
    console.error(
      "[middleware] SUPABASE_URL is not a valid URL — passing through:",
      JSON.stringify(config.url),
    );
    return response;
  }

  let user: { id: string } | null = null;
  try {
    const supabase = createServerClient(config.url, config.key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    user = data.user ?? null;
  } catch (e) {
    // Network / Supabase outage — we don't want to take the whole site down.
    console.error("[middleware] supabase auth failed — passing through:", e);
    return response;
  }

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Public catalog traffic never needs a server-side auth refresh. Keeping
  // the matcher explicit prevents one crawler request from becoming both a
  // middleware invocation and a page/function invocation.
  matcher: [
    "/upload/:path*",
    "/admin/:path*",
    "/data-admin/:path*",
    "/alerts/:path*",
    "/watchlist/:path*",
    "/api/upload/:path*",
    "/api/alerts/:path*",
    "/api/runtime-config/:path*",
    "/api/trigger-scrape/:path*",
  ],
};
