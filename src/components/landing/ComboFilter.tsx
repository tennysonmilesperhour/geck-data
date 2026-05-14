"use client";
// Compact multi-select dropdown over the full canonical combo set. Lives
// alongside the price-band slider, syncs both ways with the filter
// context's selectedCombos so clicking What's Hot or picking here both
// scope the page identically.
import { useEffect, useRef, useState } from "react";
import { useLandingFilters } from "./LandingFilters";

type Props = {
  allCombos: string[];
};

export default function ComboFilter({ allCombos }: Props) {
  const { selectedCombos, toggleCombo, clearCombos } = useLandingFilters();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const count = selectedCombos.size;
  const summary =
    count === 0
      ? "All combos"
      : count === 1
        ? [...selectedCombos][0]
        : `${count} combos selected`;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-left transition hover:border-emerald-500/40 hover:bg-ink-800"
      >
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
            Filter by combo
          </div>
          <div className="mt-0.5 truncate text-sm text-ink-100">{summary}</div>
        </div>
        <span aria-hidden className="text-ink-400">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-80 overflow-auto rounded-xl border border-ink-700 bg-ink-850 p-2 shadow-2xl">
          {count > 0 ? (
            <button
              type="button"
              onClick={clearCombos}
              className="mb-2 w-full rounded px-2 py-1 text-left text-xs text-ink-400 hover:bg-ink-800 hover:text-ink-100"
            >
              Clear all
            </button>
          ) : null}
          <ul className="space-y-0.5">
            {allCombos.map((c) => {
              const isSelected = selectedCombos.has(c);
              return (
                <li key={c}>
                  <button
                    type="button"
                    onClick={() => toggleCombo(c)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
                      isSelected
                        ? "bg-emerald-500/10 text-emerald-100"
                        : "text-ink-200 hover:bg-ink-800 hover:text-ink-50"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`inline-block h-3 w-3 shrink-0 rounded border ${
                        isSelected
                          ? "border-emerald-500/70 bg-emerald-500/40"
                          : "border-ink-600"
                      }`}
                    />
                    {c}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
