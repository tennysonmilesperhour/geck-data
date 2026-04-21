"use client";
// Sub-tabs for /market: Overview / Combos / Regional / Arbitrage / Supply /
// Breeders. Styled as rounded pills with a subtle active glow so the
// navigation stays visually distinct from the filter row above and the
// cards below.
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
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-ink-700 bg-ink-850/70 p-1 shadow-panel">
      {TABS.map((t) => {
        const active = t === tab;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
              active
                ? "border border-ready/50 bg-ready/15 text-ready shadow-[0_0_0_1px_rgba(74,222,128,0.2)_inset]"
                : "border border-transparent text-ink-300 hover:bg-ink-850 hover:text-ink-100"
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
