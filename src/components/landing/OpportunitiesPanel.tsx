"use client";
// Opportunities: single animals priced well under their combo's median ask and
// re-observed by the ingest within the last week.
//
// Two gates do the honesty work upstream in getMarketSnapshot. The freshness
// gate exists because current_status='live' is sticky, so without it the panel
// advertised ads nobody had confirmed in months. The group-lot gate exists
// because a wholesale lot at $50 against a $500 per-animal median is not a 90%
// discount, it is a different unit; that one listing was the biggest "deal" on
// the page. Both exclusions are stated in the copy below, because a discount
// with an unstated denominator is not a number a breeder can act on.
//
// Reads selectedCombos from the landing filter context: when the user has
// pinned one or more combos in What's Hot, the list narrows to just those.
// Empty filter = show all opportunities.
import { useMemo } from "react";
import { fmtUsd, fmtInt, fmtRelative } from "@/lib/format";
import type { OpportunityListing } from "@/lib/landing/snapshot";
import { useLandingFilters } from "./LandingFilters";

type Props = {
  opportunities: OpportunityListing[];
};

export default function OpportunitiesPanel({ opportunities }: Props) {
  const { selectedCombos, hoveredCombo } = useLandingFilters();

  const { priceBand } = useLandingFilters();
  const filtered = useMemo(() => {
    let list = opportunities;
    if (selectedCombos.size > 0) {
      list = list.filter(
        (o) => o.combo_name && selectedCombos.has(o.combo_name),
      );
    }
    if (priceBand) {
      const [lo, hi] = priceBand;
      list = list.filter((o) => o.price >= lo && o.price <= hi);
    }
    return list;
  }, [opportunities, selectedCombos, priceBand]);

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-panel">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay-300/80">
            Signal
          </div>
          <h2 className="mt-1 font-display text-[22px] font-medium tracking-tight text-ink-50">
            Opportunities
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            Single animals priced ≥25% below their combo&apos;s median ask, seen
            in the last 7 days. Multi-animal lots, pairs and trios are excluded.
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
          {filtered.length} {filtered.length === opportunities.length ? "found" : `of ${opportunities.length}`}
        </span>
      </header>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-ink-700/60 bg-ink-900/40 px-3 py-4 text-sm text-ink-400">
          {selectedCombos.size > 0
            ? "No opportunities match the active combo filter."
            : "No single-animal listing seen in the last 7 days is priced ≥25% below its combo median. The ingest runs weekly, so this list is thickest right after a fresh pass and can be empty by the end of the week."}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((opp) => {
            const isMatched =
              hoveredCombo != null && opp.combo_name === hoveredCombo;
            return (
              <li key={opp.id}>
                <a
                  href={opp.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group flex items-start justify-between gap-3 rounded-md border px-3 py-2.5 transition ${
                    isMatched
                      ? "border-emerald-500/50 bg-ink-800/80 shadow-[0_0_0_1px_rgba(14,154,115,0.08)]"
                      : "border-ink-700/60 bg-ink-900/40 hover:border-amber-500/40 hover:bg-ink-800/60"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-100 group-hover:text-amber-100">
                      {opp.title ?? "(no title)"}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-400">
                      {opp.combo_name} · {opp.seller_name ?? "unknown seller"}
                      {opp.seller_location ? ` · ${opp.seller_location}` : ""}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-ink-500">
                      {opp.last_seen_at
                        ? `seen ${fmtRelative(opp.last_seen_at)}`
                        : opp.first_seen_at
                          ? `first seen ${fmtRelative(opp.first_seen_at)}`
                          : "no observation date"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm tabular-nums text-ink-50">
                      {fmtUsd(opp.price)}
                    </div>
                    <div className="text-xs text-ink-500">
                      {opp.combo_median_ask != null
                        ? `vs ${fmtUsd(opp.combo_median_ask)}`
                        : "no baseline"}
                      {opp.combo_n != null ? ` (n=${fmtInt(opp.combo_n)})` : ""}
                    </div>
                    <div className="mt-0.5 inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-300">
                      −{opp.discount_pct.toFixed(1)}%
                    </div>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-4 text-ink-500">
        The baseline (n) is each combo&apos;s median ask across its whole 365 day
        live catalogue, fresh and stale together, so it is a slower number than
        the listing beside it. Combos with fewer than five live ads do not set a
        baseline at all.
      </p>
    </section>
  );
}
