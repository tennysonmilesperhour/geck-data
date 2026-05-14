"use client";
// Compact "active filters" chip strip. Shows which combos the user has
// pinned by clicking on the What's Hot list, with one-click removal and a
// global Clear. Stays out of the way when no filters are set.
import { useLandingFilters } from "./LandingFilters";

export default function FilterChips() {
  const { selectedCombos, toggleCombo, clearCombos } = useLandingFilters();

  if (selectedCombos.size === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2 text-xs">
      <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300/80">
        Filter ·
      </span>
      {[...selectedCombos].map((combo) => (
        <button
          key={combo}
          onClick={() => toggleCombo(combo)}
          className="group inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-200 transition hover:border-emerald-400/70 hover:bg-emerald-500/20"
        >
          {combo}
          <span
            aria-hidden
            className="text-[10px] opacity-60 group-hover:opacity-100"
          >
            ✕
          </span>
        </button>
      ))}
      <button
        onClick={clearCombos}
        className="ml-1 text-ink-400 underline-offset-2 hover:text-ink-100 hover:underline"
      >
        Clear
      </button>
    </div>
  );
}
