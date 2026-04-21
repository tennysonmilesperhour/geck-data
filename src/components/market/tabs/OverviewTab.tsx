"use client";
// Composes the three Overview widgets from the handoff screenshots:
//   [                 Market Index (hero, full width)                 ]
//   [      Top Movers (2/3 width)      ]   [ Market Calendar (1/3) ]
//
// Data comes from src/lib/market/fixtures.ts — swap any getX() to a real
// Supabase query once the pipeline is ready; the component API doesn't
// change.
import { useMemo } from "react";
import {
  getMarketCalendar,
  getMarketIndex,
  getTopMovers,
} from "@/lib/market/fixtures";
import type { Filters, SourceId } from "@/lib/market/types";
import MarketIndexCard from "@/components/market/widgets/MarketIndexCard";
import TopMoversPanel from "@/components/market/widgets/TopMoversPanel";
import MarketCalendarPanel from "@/components/market/widgets/MarketCalendarPanel";

export default function OverviewTab({
  filters,
  onChange,
  onSelectCombo,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onSelectCombo?: (combo: string) => void;
}) {
  // Three cheap in-memory computations keyed on filters; re-run only when
  // the user changes a control.
  const index = useMemo(() => getMarketIndex(filters), [filters]);
  const movers = useMemo(() => getTopMovers(filters), [filters]);
  const calendar = useMemo(() => getMarketCalendar(filters), [filters]);

  function applySource(id: SourceId) {
    // Clicking a source badge on the Market Index narrows the dashboard
    // to just that source. Clicking the same badge again restores "all"
    // so it reads as a toggle.
    if (
      filters.sources !== "all" &&
      filters.sources.size === 1 &&
      filters.sources.has(id)
    ) {
      onChange({ ...filters, sources: "all" });
      return;
    }
    onChange({ ...filters, sources: new Set([id]) });
  }

  return (
    <div className="space-y-4">
      <MarketIndexCard data={index} onFilterBySource={applySource} filters={filters} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <TopMoversPanel
            appreciating={movers.appreciating}
            depreciating={movers.depreciating}
            onSelectCombo={onSelectCombo}
          />
        </div>
        <MarketCalendarPanel entries={calendar} />
      </div>
    </div>
  );
}
