// Runs on every request. Two jobs:
//   1) Keep the user's Supabase session cookie fresh
//   2) Gate /upload to logged-in users (sends others to /login)
//
// If the Supabase env vars are missing or malformed, we pass the request
// through instead of 500'ing MIDDLEWARE_INVOCATION_FAILED. Protected pages
// add their own server-side auth check as a belt-and-suspenders.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  const pathname = request.nextUrl.pathname;
  const isProtected =
    pathname.startsWith("/upload") || pathname.startsWith("/api/upload");

  if (!url || !key) {
    // No Supabase config visible to the edge runtime. We can't refresh the
    // session cookie or enforce the gate; fall back to letting the request
    // through so the public routes still render. Protected pages must
    // enforce auth themselves.
    console.warn(
      "[middleware] Supabase env not set (url? %s, key? %s) — passing through",
      !!url,
      !!key,
    );
    return response;
  }

  // Quick URL validation to avoid a cryptic fetch failure deeper in the stack.
  try {
    new URL(url);
  } catch {
    console.error(
      "[middleware] SUPABASE_URL is not a valid URL — passing through:",
      JSON.stringify(url),
    );
    return response;
  }

  let user: { id: string } | null = null;
  try {
    const supabase = createServerClient(url, key, {
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
  // Match every path except static assets, Next internals, and the
  // machine-to-machine /api/ingest endpoint (it has its own Bearer auth
  // and does not need the Supabase session cookie refresh).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/ingest|.*\\..*).*)"],
};
