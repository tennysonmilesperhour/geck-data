"use client";
// Live ads asking less than the ads they are comparable to.
//
// This panel was called "Opportunities" and it was not one. It measured every
// listing against its combo's median across the whole 365 day catalogue, which
// pooled babies with adults, stale asks with fresh ones, and auctions and
// wholesale lots with single animals. The result read as a bargain list and
// was mostly an age list: the deepest "discounts" were juveniles priced like
// juveniles next to a median carrying adults.
//
// What survives that correction is a narrower and duller claim, which is the
// point. A card here says one thing: this ad asks less than the freshly
// confirmed ads with the same trait pair and the same age class. Whether that
// is a good buy depends on sex, weight, structure, lineage and grading, none
// of which this dataset holds, so the copy stops at the observation and the
// verbs stay out of it.
//
// Reads selectedCombos from the landing filter context: when the user has
// pinned one or more combos in What's Hot, the list narrows to just those.
// Empty filter = show all.
import { useMemo } from "react";
import { fmtUsd, fmtInt, fmtRelative } from "@/lib/format";
import type { BelowCompsListing } from "@/lib/landing/snapshot";
import { useLandingFilters } from "./LandingFilters";

type Props = {
  listings: BelowCompsListing[];
};

export default function BelowCompsPanel({ listings }: Props) {
  const { selectedCombos, hoveredCombo, priceBand } = useLandingFilters();

  const filtered = useMemo(() => {
    let list = listings;
    if (selectedCombos.size > 0) {
      list = list.filter(
        (o) => o.comp_combo && selectedCombos.has(o.comp_combo),
      );
    }
    if (priceBand) {
      const [lo, hi] = priceBand;
      list = list.filter((o) => o.price >= lo && o.price <= hi);
    }
    return list;
  }, [listings, selectedCombos, priceBand]);

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-panel">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay-300/80">
            Observation
          </div>
          <h2 className="mt-1 font-display text-[22px] font-medium tracking-tight text-ink-50">
            Asking under comparables
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            Ads priced at least 25% below the median ask of live ads with the
            same trait pair <em>and</em> the same age class, both sides
            confirmed in the current ingest cycle.
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
          {filtered.length}{" "}
          {filtered.length === listings.length ? "found" : `of ${listings.length}`}
        </span>
      </header>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-ink-700/60 bg-ink-900/40 px-3 py-4 text-sm text-ink-400">
          {selectedCombos.size > 0
            ? "No listing under the active combo filter is asking below its comparables."
            : "Nothing currently clears the bar. A comparison only exists where five or more freshly confirmed ads from three or more sellers share a trait pair and an age class, and most trait pairs never get that thick. An empty list here means no claim is supported, not that the market has no cheap animals in it."}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => {
            const isMatched =
              hoveredCombo != null && row.comp_combo === hoveredCombo;
            return (
              <li key={row.id}>
                <a
                  href={row.url ?? "#"}
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
                      {row.title ?? "(no title)"}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-400">
                      {row.maturity ?? "age not stated"} · {row.comp_combo} ·{" "}
                      {row.seller_name ?? "unknown seller"}
                      {row.seller_location ? ` · ${row.seller_location}` : ""}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-ink-500">
                      {row.last_seen_at
                        ? `seen ${fmtRelative(row.last_seen_at)}`
                        : row.first_seen_at
                          ? `first seen ${fmtRelative(row.first_seen_at)}`
                          : "no observation date"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm tabular-nums text-ink-50">
                      {fmtUsd(row.price)}
                    </div>
                    <div className="text-xs text-ink-500">
                      {row.comp_median_ask != null
                        ? `vs ${fmtUsd(row.comp_median_ask)}`
                        : "no comparison"}
                      {row.comp_n != null && row.comp_sellers != null
                        ? ` (${fmtInt(row.comp_n)} ads, ${fmtInt(row.comp_sellers)} sellers)`
                        : ""}
                    </div>
                    <div className="mt-0.5 inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-300">
                      {row.pct_below.toFixed(1)}% below
                    </div>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-4 text-ink-500">
        Where an ad belongs to several trait pairs it is measured against the
        cheapest of them, so the percentage is the smallest one the data
        supports. Group lots and auctions are excluded from both sides. Sex,
        weight, structure, lineage and pet-only grading are not in this dataset
        and are not controlled for, and every figure here is an asking price,
        not a sale.
      </p>
    </section>
  );
}
