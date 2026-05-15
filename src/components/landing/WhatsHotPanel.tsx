"use client";
// What's Hot — top combos ranked by current activity (live + sold count).
// Visual rank bars proportional to total volume. Click a row to pin it as
// an active filter; the Opportunities panel listens to the same context.
// Hovering a row writes hoveredCombo into the shared filter state for
// cross-widget linking.
import Link from "next/link";
import { fmtUsd, fmtInt } from "@/lib/format";
import type { ComboSnapshot } from "@/lib/landing/snapshot";
import ConfidenceBadge from "@/components/market/ConfidenceBadge";
import MorphTerm from "@/components/morphs/MorphTerm";
import { useLandingFilters } from "./LandingFilters";

type Props = {
  combos: ComboSnapshot[];
  limit?: number;
};

export default function WhatsHotPanel({ combos, limit = 8 }: Props) {
  const { hoveredCombo, selectedCombos, toggleCombo, setHoveredCombo } =
    useLandingFilters();

  const rows = combos.slice(0, limit);
  const maxVolume = Math.max(
    ...rows.map((c) => c.live_count + c.sold_count),
    1,
  );

  return (
    <section
      id="whats-hot"
      className="rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-panel"
    >
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
            Pulse
          </div>
          <h2 className="mt-1 font-display text-[22px] font-medium tracking-tight text-ink-50">
            What&apos;s hot
          </h2>
          <p className="mt-1.5 text-xs text-ink-400">
            Top combos by current activity. <span className="text-ink-300">Click</span> to filter the page.
          </p>
        </div>
        <Link
          href="/market"
          className="text-xs text-ink-400 transition hover:text-ink-100"
        >
          All combos →
        </Link>
      </header>

      <ol className="space-y-2">
        {rows.length === 0 ? (
          <li className="rounded-md border border-ink-700/60 bg-ink-900/40 px-3 py-4 text-sm text-ink-400">
            No combo activity in the current window.
          </li>
        ) : (
          rows.map((combo, idx) => {
            const total = combo.live_count + combo.sold_count;
            const widthPct = Math.max(4, (total / maxVolume) * 100);
            const isSelected = selectedCombos.has(combo.combo_name);
            const isHovered = hoveredCombo === combo.combo_name;
            return (
              <li key={combo.combo_name}>
                <button
                  type="button"
                  onClick={() => toggleCombo(combo.combo_name)}
                  onMouseEnter={() => setHoveredCombo(combo.combo_name)}
                  onMouseLeave={() => setHoveredCombo(null)}
                  className={`group relative block w-full overflow-hidden rounded-md border px-3 py-2.5 text-left transition ${
                    isSelected
                      ? "border-emerald-500/60 bg-emerald-500/[0.08]"
                      : isHovered
                        ? "border-emerald-500/30 bg-ink-800/60"
                        : "border-ink-700/60 bg-ink-900/40 hover:border-emerald-500/30 hover:bg-ink-800/60"
                  }`}
                >
                  <div
                    aria-hidden
                    className={`absolute inset-y-0 left-0 transition-all ${
                      isSelected
                        ? "bg-gradient-to-r from-emerald-500/15 to-emerald-500/0"
                        : "bg-gradient-to-r from-emerald-500/[0.06] to-emerald-500/0"
                    }`}
                    style={{ width: `${widthPct}%` }}
                  />
                  <div className="relative flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-5 font-mono text-[10px] text-ink-500">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <MorphTerm
                        name={combo.combo_name}
                        className={`font-medium ${isSelected ? "text-emerald-100" : "text-ink-100"}`}
                      />
                    </div>
                    <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums text-ink-300">
                      <span>
                        <span className="text-ink-500">live </span>
                        {fmtInt(combo.live_count)}
                      </span>
                      <span className="hidden md:inline">
                        <span className="text-ink-500">sold </span>
                        {fmtInt(combo.sold_count)}
                      </span>
                      <span className="text-ink-100">
                        {combo.median_ask ? fmtUsd(combo.median_ask) : "—"}
                      </span>
                      <ConfidenceBadge score={combo.confidence_score} />
                    </div>
                  </div>
                </button>
              </li>
            );
          })
        )}
      </ol>
    </section>
  );
}

