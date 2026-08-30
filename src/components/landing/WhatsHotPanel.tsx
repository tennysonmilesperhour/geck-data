"use client";
// What's Hot: top combos ranked by freshly confirmed live ads (last_seen
// inside 48h). Catalogue-wide 365d counts stay on the card only as a
// secondary label, never as "157 live".
// Visual rank bars proportional to total volume. Click a row to pin it as
// an active filter; the Opportunities panel listens to the same context.
// Hovering a row writes hoveredCombo into the shared filter state for
// cross-widget linking.
import Link from "next/link";
import { fmtUsd } from "@/lib/format";
import type { ComboSnapshot } from "@/lib/landing/snapshot";
import ConfidenceBadge from "@/components/market/ConfidenceBadge";
import MorphTerm from "@/components/morphs/MorphTerm";
import PopulationBadge from "@/components/morphs/PopulationBadge";
import MiniSparkline from "@/components/charts/MiniSparkline";
import { comboFromName } from "@/lib/market/combos";
import { comboSlugFromId } from "@/lib/market/combo-slug";
import { anchorOf, paletteFor } from "@/lib/market/anchors";
import { useLandingFilters } from "./LandingFilters";

type Props = {
  combos: ComboSnapshot[];
  /** Combo_name -> 14 daily arrival counts (oldest first). */
  comboDaily?: Map<string, number[]>;
  limit?: number;
};

export default function WhatsHotPanel({ combos, comboDaily, limit = 8 }: Props) {
  const { hoveredCombo, selectedCombos, toggleCombo, setHoveredCombo } =
    useLandingFilters();

  const rows = combos.slice(0, limit);
  const useFresh = rows.some((c) => c.fresh_live_count > 0);
  const maxVolume = Math.max(
    ...rows.map((c) =>
      useFresh ? c.fresh_live_count : c.live_count + c.sold_count,
    ),
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
            Ranked by ads re-confirmed in the last 48 hours, with that
            window&apos;s median. Catalogue totals are labelled as catalogue.{" "}
            <span className="text-ink-300">Click</span> to filter the page.
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
            const total = useFresh
              ? combo.fresh_live_count
              : combo.live_count + combo.sold_count;
            const widthPct = Math.max(4, (total / maxVolume) * 100);
            const isSelected = selectedCombos.has(combo.combo_name);
            const isHovered = hoveredCombo === combo.combo_name;
            const anchor = anchorOf(combo.combo_name);
            const palette = paletteFor(anchor);
            const barColor = palette?.hex ?? "#10b981";
            const barSoft = palette?.soft ?? "rgba(16,185,129,0.08)";
            return (
              <li key={combo.combo_name}>
                <button
                  type="button"
                  onClick={() => toggleCombo(combo.combo_name)}
                  onMouseEnter={() => setHoveredCombo(combo.combo_name)}
                  onMouseLeave={() => setHoveredCombo(null)}
                  className={`group relative block w-full rounded-md border px-3 py-2.5 text-left transition ${
                    isSelected
                      ? "bg-ink-800/60"
                      : isHovered
                        ? "bg-ink-800/60"
                        : "bg-ink-900/40 hover:bg-ink-800/60"
                  }`}
                  style={{
                    borderColor: isSelected ? barColor : isHovered ? `${barColor}88` : "rgba(35,68,54,0.6)",
                  }}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 overflow-hidden rounded-md"
                  >
                    <span
                      className="absolute inset-y-0 left-0 transition-all"
                      style={{
                        width: `${widthPct}%`,
                        backgroundImage: `linear-gradient(90deg, ${barSoft} 0%, transparent 100%)`,
                      }}
                    />
                    <span
                      className="absolute inset-y-0 left-0 w-[3px]"
                      style={{ background: barColor, opacity: isSelected ? 1 : 0.7 }}
                    />
                  </span>
                  <div className="relative flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-5 font-mono text-[10px] text-ink-500">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      {(() => {
                        // Curated combos route by their short id; every
                        // auto-discovered pair routes by its slug, which
                        // /combo/[slug] resolves via resolveComboFromSlug. So
                        // the whole list is navigable, not just the dozen.
                        const canonical = comboFromName(combo.combo_name);
                        const href = canonical
                          ? `/combo/${canonical.id}`
                          : `/combo/${comboSlugFromId(combo.combo_name)}`;
                        const cls = `font-medium ${isSelected ? "text-emerald-100" : "text-ink-100"}`;
                        return (
                          <Link
                            href={href}
                            onClick={(e) => e.stopPropagation()}
                            className={`${cls} hover:text-claude-glow`}
                          >
                            <MorphTerm name={combo.combo_name} />
                          </Link>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums text-ink-300">
                      {comboDaily?.get(combo.combo_name) ? (
                        <span className="hidden sm:inline-block">
                          <MiniSparkline
                            values={comboDaily.get(combo.combo_name)!}
                            width={80}
                            height={20}
                            fill
                            color={palette?.hex}
                          />
                        </span>
                      ) : null}
                      <span className="hidden md:inline">
                        <PopulationBadge
                          live={
                            useFresh ? combo.fresh_live_count : combo.live_count
                          }
                          liveWindow={useFresh ? "48h fresh" : "catalogue"}
                          sold={combo.sold_count}
                        />
                      </span>
                      <span className="text-ink-100">
                        {useFresh
                          ? combo.fresh_median_ask
                            ? fmtUsd(combo.fresh_median_ask)
                            : "n/a"
                          : combo.median_ask
                            ? fmtUsd(combo.median_ask)
                            : "n/a"}
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

      <p className="mt-3 text-[11px] leading-4 text-ink-500">
        Sparklines count arrivals per day over the last 14 days, dated by
        MorphMarket&apos;s own list date where the source gave us one and by the
        date our ingest first saw the ad otherwise. The ingest runs weekly, so a
        flat stretch means no pass ran, not that nothing was listed.
      </p>
    </section>
  );
}

