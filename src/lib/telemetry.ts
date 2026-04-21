"use client";
// Client-side telemetry. Writes to public.user_events + public.error_logs via
// the anon key (both tables allow anon INSERT and only admins can read back —
// see 0003_admin_analytics.sql).
//
// We explicitly do NOT crash the app on telemetry failures. Every insert is
// wrapped in try/catch and the promise is "fire-and-forget" — a user flow
// continuing to work is always more important than a clean event stream.
//
// PostHog (if we ever add it) captures raw click/pageview noise. This module
// is for the small set of events we want to slice *inside* the admin dashboard
// and join against relational tables (auth.users, market_listings, alerts…).
import { createClient } from "@/lib/supabase/client";

const SESSION_KEY = "geck_session_id";
const THROTTLE_MS = 2000;
const SOURCE = "geck-inspect";

// ----------------------------------------------------------------------------
// Session id — one per browser tab session, stable across navigations within
// that tab. Falls back to a sentinel if sessionStorage is unavailable (SSR,
// private mode lockdown).
// ----------------------------------------------------------------------------
function getSessionId(): string {
  if (typeof window === "undefined") return "no_session";
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "no_session";
  }
}

// ----------------------------------------------------------------------------
// Throttle — drop repeat events for 2s. Specifically targets double-fire
// loops (React StrictMode double-invokes, effects that re-run on state
// changes, etc.). Keyed by name + first 80 chars of properties.
// ----------------------------------------------------------------------------
const lastFired = new Map<string, number>();
function shouldThrottle(key: string): boolean {
  const now = Date.now();
  const prev = lastFired.get(key);
  if (prev && now - prev < THROTTLE_MS) return true;
  lastFired.set(key, now);
  return false;
}

async function currentEmail(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// trackEvent — primary instrumentation entry point.
//
// Usage:
//   trackEvent("upload_started", { filename, bytes });
//   trackEvent("alert_created", { query_type: "maturity" });
//
// Notes:
//   - `properties` is stored verbatim as JSONB. Don't put secrets in it.
//   - Returns a Promise but don't await it in hot paths.
// ----------------------------------------------------------------------------
export async function trackEvent(
  name: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (typeof window === "undefined") return;

  const propsStr = (() => {
    try {
      return JSON.stringify(properties).slice(0, 80);
    } catch {
      return "";
    }
  })();
  if (shouldThrottle(`${name}|${propsStr}`)) return;

  try {
    const supabase = createClient();
    const email = await currentEmail();
    await supabase.from("user_events").insert({
      event_name: name,
      user_email: email,
      page: window.location.pathname,
      session_id: getSessionId(),
      source: SOURCE,
      properties,
    });
  } catch {
    // telemetry failures must never propagate
  }
}

// ----------------------------------------------------------------------------
// trackPageView — thin convenience wrapper. Pass an explicit page name to
// override the pathname (useful for routes with dynamic segments you want
// to collapse, e.g. trackPageView("/sellers/[id]")).
// ----------------------------------------------------------------------------
export function trackPageView(pageName?: string): void {
  const page =
    pageName ?? (typeof window !== "undefined" ? window.location.pathname : "");
  void trackEvent("page_view", { page });
}

// ----------------------------------------------------------------------------
// reportError — insert into public.error_logs. Accepts an Error or a string.
// Truncates message@1000 and stack@4000 to keep row sizes bounded.
// ----------------------------------------------------------------------------
type ErrorInfo = {
  level?: "error" | "warning" | "info";
  [k: string]: unknown;
};

export async function reportError(
  error: Error | string,
  info: ErrorInfo = {},
): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const supabase = createClient();
    const email = await currentEmail();
    const isErr = typeof error !== "string";
    const rawMessage = isErr ? (error as Error).message : (error as string);
    const message = (rawMessage ?? "unknown error").slice(0, 1000);
    const stack = isErr ? ((error as Error).stack ?? "").slice(0, 4000) : null;

    const { level = "error", ...rest } = info;

    await supabase.from("error_logs").insert({
      level,
      message,
      stack,
      url: window.location.href,
      user_email: email,
      user_agent: navigator.userAgent,
      source: SOURCE,
      context: rest,
    });
  } catch {
    // swallow
  }
}

// ----------------------------------------------------------------------------
// installGlobalErrorHandlers — idempotent. Wires window.error +
// unhandledrejection so uncaught exceptions and rejected promises show up in
// the admin Errors tab alongside React ErrorBoundary catches.
// ----------------------------------------------------------------------------
let handlersInstalled = false;
export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined" || handlersInstalled) return;
  handlersInstalled = true;

  window.addEventListener("error", (e) => {
    const err =
      e.error instanceof Error
        ? e.error
        : new Error(e.message || "window.error");
    void reportError(err, {
      type: "window.error",
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    const err =
      reason instanceof Error ? reason : new Error(String(reason ?? "unhandledrejection"));
    void reportError(err, { type: "unhandledrejection" });
  });
}
