"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { ScrollytellingData } from "@/lib/landing/scrolly-types";

const ScrollytellingSection = dynamic(() => import("./ScrollytellingSection"), {
  ssr: false,
  loading: () => (
    <p className="border-t border-ink-700/60 px-5 py-8 text-sm text-ink-400">
      Loading the market study…
    </p>
  ),
});

export default function ExpandableMarketStory() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ScrollytellingData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const loadStory = async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/pulse/story");
      if (!response.ok) throw new Error(`Story request failed: ${response.status}`);
      setData((await response.json()) as ScrollytellingData);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const toggleStory = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !data && status !== "loading") void loadStory();
  };

  return (
    <section className="overflow-hidden border border-ink-700 bg-ink-850">
      <button
        type="button"
        className="flex min-h-20 w-full items-center justify-between gap-6 px-5 py-4 text-left transition hover:bg-ink-800/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-400"
        aria-expanded={open}
        onClick={toggleStory}
      >
        <span>
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300">
            Deeper analysis
          </span>
          <strong className="mt-1 block text-sm font-medium text-ink-100">
            Pricing distribution, trait economics, geography, velocity, and listing cadence
          </strong>
          <small className="mt-1 block text-xs leading-5 text-ink-400">
            The historical study is fetched only when opened, keeping the default Pulse fast and compact.
          </small>
        </span>
        <span className="flex shrink-0 items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
          {open ? "Close study" : "Open study"}
          <span aria-hidden className="grid h-7 w-7 place-items-center border border-ink-700 text-base">
            {open ? "−" : "+"}
          </span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-ink-700 p-5 md:p-8">
          {data ? <ScrollytellingSection data={data} /> : status === "error" ? (
            <div className="py-8 text-center">
              <p className="text-sm text-ink-300">The market study could not be loaded.</p>
              <button type="button" onClick={() => void loadStory()} className="mt-3 border border-ink-700 px-3 py-2 text-xs text-emerald-300 hover:bg-ink-800">
                Try again
              </button>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-ink-400">Loading the market study…</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
