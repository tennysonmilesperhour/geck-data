"use client";
// Shows a refresh prompt when the tab is running an older deployment than the
// one currently live in production. The build the page was served from is
// inlined at build time as NEXT_PUBLIC_BUILD_ID; /api/version reports the
// build of whichever deployment is serving requests right now. When they
// diverge, the user is offered a one-click reload onto the latest main.
//
// Polls on an interval and whenever the tab regains focus (covers the common
// case of a phone waking from sleep on a page left open for hours). No-ops in
// local dev, where both ids are "dev".
import { useCallback, useEffect, useRef, useState } from "react";

const CURRENT_BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const POLL_MS = 60_000;

export default function VersionToast() {
  const [latestBuild, setLatestBuild] = useState<string | null>(null);
  // Track which build the user dismissed so the toast stays hidden for that
  // version but can reappear if an even newer deploy lands.
  const dismissedRef = useRef<string | null>(null);

  const check = useCallback(async () => {
    // Nothing to compare against in dev / when the id wasn't injected.
    if (CURRENT_BUILD === "dev") return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { buildId?: string };
      if (data.buildId && data.buildId !== "dev") {
        setLatestBuild(data.buildId);
      }
    } catch {
      // Offline or transient error — leave state as-is and retry next tick.
    }
  }, []);

  useEffect(() => {
    if (CURRENT_BUILD === "dev") return;
    check();
    const id = window.setInterval(check, POLL_MS);
    const onFocus = () => check();
    const onVisible = () => {
      if (!document.hidden) check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  const stale =
    latestBuild !== null &&
    latestBuild !== CURRENT_BUILD &&
    latestBuild !== dismissedRef.current;

  if (!stale) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="page-rise fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-lg border border-claude/40 bg-ink-850 p-3 shadow-2xl sm:inset-x-auto sm:right-4"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="status-dot info shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-50">A new version is available</p>
          <p className="text-xs text-ink-400">
            You&rsquo;re viewing an older build. Refresh to load the latest.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-claude px-3 py-1.5 text-sm text-ink-50 shadow-glow hover:bg-claude-glow"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              dismissedRef.current = latestBuild;
              setLatestBuild(null);
            }}
            aria-label="Dismiss"
            className="rounded-md px-1.5 py-1 text-ink-400 hover:text-ink-100"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
