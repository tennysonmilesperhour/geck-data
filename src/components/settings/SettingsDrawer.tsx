"use client";
// Slide-in drawer for chart settings, triggered from the header gear icon.
// The trigger is rendered here so the header file stays small.
import { useEffect, useState } from "react";
import Link from "next/link";
import ChartSettingsPanel from "./ChartSettingsPanel";

export default function SettingsDrawer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open chart settings"
        title="Chart settings"
        className="rounded-md border border-ink-700 bg-ink-850 p-1.5 text-ink-300 hover:border-ink-600 hover:text-ink-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label="Chart settings"
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-ink-700 bg-ink-900 shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-50">
                  Chart settings
                </h2>
                <p className="text-xs text-ink-400">
                  Choose a preset or pick charts per page.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/settings"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-300 hover:border-ink-600 hover:text-ink-50"
                >
                  Full view
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-ink-400 hover:text-ink-100"
                  aria-label="Close settings"
                >
                  ✕
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <ChartSettingsPanel />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
