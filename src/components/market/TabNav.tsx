"use client";
// Sub-tabs for /market: Overview / Combos / Regional / Arbitrage / Supply /
// Breeders. Styled as rounded pills with a subtle emerald glow so the
// active tab reads clearly against the forest-tinted surface.
import type { Tab } from "@/lib/market/types";
import { TABS } from "@/lib/market/types";

const ICON: Record<Tab, string> = {
  overview: "◧",
  combos: "◆",
  regional: "⬢",
  arbitrage: "◎",
  supply: "⚘",
  breeders: "☰",
};

const LABEL: Record<Tab, string> = {
  overview: "Overview",
  combos: "Combos",
  regional: "Regional",
  arbitrage: "Arbitrage",
  supply: "Supply",
  breeders: "Breeders",
};

export default function TabNav({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <div className="forest-surface-soft flex flex-wrap items-center gap-1 p-1">
      {TABS.map((t) => {
        const active = t === tab;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
              active
                ? "border border-ready/50 bg-ready/15 text-ready shadow-[inset_0_0_0_1px_rgba(74,222,128,0.2),_0_0_20px_-6px_rgba(74,222,128,0.35)]"
                : "border border-transparent text-forest-300 hover:bg-forest-850 hover:text-forest-100"
            }`}
          >
            <span aria-hidden className="text-[11px]">
              {ICON[t]}
            </span>
            <span>{LABEL[t]}</span>
          </button>
        );
      })}
    </div>
  );
}
