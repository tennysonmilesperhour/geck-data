// Members-only access for listing-level data.
//
// Public pages and APIs show aggregates (medians, counts, indices). Anything
// that names a single listing, its photos or its seller is for signed-in
// members only, because those records come from third-party marketplaces.
//
// A request counts as a member when it carries either:
//   - a Supabase session cookie for a signed-in user (this site's /login, the
//     same accounts as Geck Inspect), or
//   - Authorization: Bearer <token>, where the token is a Supabase access
//     token for a signed-in user (Geck Inspect's app can forward its own) or
//     one of the configured machine tokens (INGEST_API_KEY, MEMBER_API_TOKEN).
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { matchesApiToken } from "@/lib/auth/tokens";

export async function isMemberRequest(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (bearer) {
    if (matchesApiToken(bearer, [process.env.INGEST_API_KEY, process.env.MEMBER_API_TOKEN])) {
      return true;
    }
    const config = getPublicSupabaseEnv();
    if (!config) return false;
    try {
      const supabase = createSupabaseJsClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data } = await supabase.auth.getUser(bearer);
      return Boolean(data.user);
    } catch {
      return false;
    }
  }

  // No Supabase auth cookie means no session; skip the network call so
  // signed-out traffic (mostly crawlers) costs nothing.
  const cookie = req.headers.get("cookie") ?? "";
  if (!/sb-[^=]*-auth-token/.test(cookie)) return false;
  try {
    const supabase = await createCookieClient();
    const { data } = await supabase.auth.getUser();
    return Boolean(data.user);
  } catch {
    return false;
  }
}

export const MEMBERS_ONLY_BODY = {
  error: "members_only",
  message:
    "Listing-level data (single listings, photos and sellers) is for signed-in Geck Inspect members. Sign in at https://geck-data.vercel.app/login, or send Authorization: Bearer <your Supabase access token>. Aggregate prices are public at /api/market/temperature, /api/value-report and https://geckinspect.com/data.",
};

/** CORS headers for gated endpoints: any origin, Bearer tokens, no cookies. */
export const MEMBER_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  Vary: "Authorization, Cookie",
};
