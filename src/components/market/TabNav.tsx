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

// Plain-English explanation of each tab. Surfaced via the button's
// title attribute so hovering reveals "what you'll find here"
// before clicking — important for beginner breeders landing on the
// dashboard without context.
const DESCRIPTION: Record<Tab, string> = {
  overview:
    "Headline index, hottest trait combos right now, and the regional spread map. Start here.",
  combos:
    "Individual trait combinations (Lilly White Harlequin, Axanthic Pinstripe, etc.) — price band, demand signal, and population history per combo.",
  regional:
    "Regional pricing and arbitrage map: where each morph commands a premium and where it sells at a discount.",
  arbitrage:
    "Cross-region price gaps worth knowing: which morphs have the widest spread between cheapest and priciest markets.",
  supply:
    "Forward supply outlook: breeder pairings tracked, expected hatchlings, and where future inventory will land.",
  breeders:
    "Top breeders ranked by output, specialty, and reputation. Cross-references combos to their notable producers.",
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
            title={DESCRIPTION[t]}
            aria-label={`${LABEL[t]} tab: ${DESCRIPTION[t]}`}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
              active
                ? "border border-ready/50 bg-ready/15 text-ready shadow-[inset_0_0_0_1px_rgba(123,191,131,0.2),_0_0_20px_-6px_rgba(123,191,131,0.35)]"
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
