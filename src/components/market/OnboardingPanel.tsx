// Expandable "how to read this dashboard" panel. Defaults to closed
// for repeat visitors so it doesn't add visual noise, but spelled out
// in detail when opened so a first-time breeder gets enough context
// to use every tab without trial-and-error.
//
// Uses the native <details>/<summary> elements: zero JS, keyboard
// accessible by default, screen readers announce it correctly.
import { TABS } from "@/lib/market/types";
import type { Tab } from "@/lib/market/types";

const SUMMARIES: Record<Tab, { title: string; body: string }> = {
  overview: {
    title: "Overview",
    body:
      "The headline index is a weighted basket of high-value trait combinations. Hot Combos surface which morphs are moving right now. Regional Spread maps where each morph commands a premium.",
  },
  combos: {
    title: "Combos",
    body:
      "Drill into a single trait combination. Each combo has its own price band, demand signal, and population trajectory.",
  },
  regional: {
    title: "Regional",
    body:
      "How prices vary by region. Useful for spotting where to source value and where to sell premium.",
  },
  arbitrage: {
    title: "Arbitrage",
    body:
      "Morphs with the widest cross-region price gaps — opportunities for breeders willing to ship.",
  },
  supply: {
    title: "Supply",
    body:
      "Forward look at breeder pairings tracked, expected hatchlings, and inventory pipeline.",
  },
  breeders: {
    title: "Breeders",
    body:
      "Who produces what, ranked by output and specialty. Click through to a breeder's combos to see what they're known for.",
  },
};

export default function OnboardingPanel() {
  return (
    <details className="forest-surface-soft group rounded-xl p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-forest-200 transition hover:text-forest-50 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ready/15 text-[10px] text-ready ring-1 ring-inset ring-ready/30"
          >
            ?
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-forest-300">
            How to read this dashboard
          </span>
        </span>
        <span
          aria-hidden
          className="font-mono text-xs text-forest-400 transition group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm text-forest-300 md:grid-cols-2">
        <p className="md:col-span-2">
          Each number on the page carries two markers: a{" "}
          <span className="text-forest-100">source badge</span> showing where
          the data came from (GI sales, Pangea, MorphMarket, etc.) and a{" "}
          <span className="text-forest-100">confidence score</span> (0–100)
          reflecting how robust the underlying sample is. Hover either for
          the full explanation. Higher confidence means thicker, more
          consistent observations behind the number.
        </p>
        {TABS.map((t) => {
          const item = SUMMARIES[t];
          return (
            <div key={t}>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ready">
                {item.title}
              </div>
              <div className="mt-0.5 text-[13px] leading-relaxed text-forest-300">
                {item.body}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
