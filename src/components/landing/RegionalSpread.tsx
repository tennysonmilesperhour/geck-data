"use client";
// Simple regional median-ask comparison. For each region with data, shows
// the median ask price for the top-3 combos in that region as a horizontal
// bar. Lightweight and honest — when a region has thin data the bars
// degrade to "—" rather than faking it.
import { useMemo } from "react";
import type { RegionalCell } from "@/lib/landing/scrollytelling";
import { fmtUsd } from "@/lib/format";

const REGION_ORDER = ["US", "CA", "UK", "EU", "AU", "JP", "SE", "SEA"] as const;
const TOP_COMBOS_PER_REGION = 3;

export default function RegionalSpread({ cells }: { cells: RegionalCell[] }) {
  const grouped = useMemo(() => {
    const by: Map<string, RegionalCell[]> = new Map();
    for (const c of cells) {
      if (!c.median_ask || c.median_ask <= 0) continue;
      const arr = by.get(c.region) ?? [];
      arr.push(c);
      by.set(c.region, arr);
    }
    for (const [region, arr] of by) {
      arr.sort((a, b) => b.n - a.n);
      by.set(region, arr.slice(0, TOP_COMBOS_PER_REGION));
    }
    return by;
  }, [cells]);

  const allMedians = useMemo(
    () => cells.map((c) => c.median_ask ?? 0).filter((v) => v > 0),
    [cells],
  );
  const maxMedian = allMedians.length ? Math.max(...allMedians) : 1;

  const orderedRegions = REGION_ORDER.filter((r) => grouped.has(r));

  if (orderedRegions.length === 0) {
    return (
      <div className="rounded-lg border border-ink-700/60 bg-ink-900/40 p-4 text-sm text-ink-400">
        No regional data yet — needs more sold observations to surface.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {orderedRegions.map((region) => {
        const rows = grouped.get(region)!;
        return (
          <div
            key={region}
            className="rounded-lg border border-ink-700/60 bg-ink-900/40 p-3"
          >
            <div className="mb-2 flex items-baseline justify-between">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-300">
                {region}
              </div>
              <div className="font-mono text-[10px] text-ink-500">
                top {rows.length} by volume
              </div>
            </div>
            <ul className="space-y-1.5">
              {rows.map((row) => {
                const pct = ((row.median_ask ?? 0) / maxMedian) * 100;
                return (
                  <li
                    key={`${row.region}-${row.combo_name}`}
                    className="relative overflow-hidden rounded px-2 py-1.5"
                  >
                    <div
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-500/15 to-sky-500/0"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex items-center justify-between gap-3">
                      <span className="truncate text-sm text-ink-100">
                        {row.combo_name}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-ink-300">
                        {fmtUsd(row.median_ask)}
                        <span className="ml-2 text-ink-500">n={row.n}</span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
