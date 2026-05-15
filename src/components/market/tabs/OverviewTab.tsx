"use client";
// Composes the Overview widgets:
//   [                   Market Index (hero, full width)                  ]
//   [                   Top Movers (full width)                           ]
//   [                    Peak Indicator grid (full width)                ]
//
// Market Index / Top Movers / Peak Indicator read real data via the
// queries module; each one falls back to fixtures when the underlying
// views return empty so the dashboard never goes blank. Market Calendar
// was a hardcoded fixture (event data isn't in Supabase) — removed
// until we have real expo / breeder-release data to surface.
import {
  fetchMarketIndex,
  fetchPeakIndicators,
  fetchTopMovers,
} from "@/lib/market/queries";
import { useFilteredQuery } from "@/lib/market/useFilteredQuery";
import type { Filters, SourceId } from "@/lib/market/types";
import MarketIndexCard from "@/components/market/widgets/MarketIndexCard";
import TopMoversPanel from "@/components/market/widgets/TopMoversPanel";
import PeakIndicatorGrid from "@/components/market/widgets/PeakIndicatorGrid";

export default function OverviewTab({
  filters,
  onChange,
  onSelectCombo,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onSelectCombo?: (combo: string) => void;
}) {
  const indexQ = useFilteredQuery(fetchMarketIndex, filters, [] as const);
  const moversQ = useFilteredQuery(fetchTopMovers, filters, [] as const);
  const peaksQ = useFilteredQuery(fetchPeakIndicators, filters, [] as const);

  function applySource(id: SourceId) {
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
      {indexQ.data ? (
        <MarketIndexCard
          data={indexQ.data}
          onFilterBySource={applySource}
          filters={filters}
          status={indexQ.status}
          note={indexQ.note}
        />
      ) : (
        <div className="forest-surface p-6 text-sm text-forest-400">
          Loading Market Index…
        </div>
      )}

      {moversQ.data ? (
        <TopMoversPanel
          appreciating={moversQ.data.appreciating}
          depreciating={moversQ.data.depreciating}
          onSelectCombo={onSelectCombo}
          status={moversQ.status}
          note={moversQ.note}
        />
      ) : (
        <div className="forest-surface p-6 text-sm text-forest-400">
          Loading Top Movers…
        </div>
      )}

      {peaksQ.data ? (
        <PeakIndicatorGrid
          indicators={peaksQ.data}
          status={peaksQ.status}
          note={peaksQ.note}
        />
      ) : (
        <div className="forest-surface p-6 text-sm text-forest-400">
          Loading Peak Indicator…
        </div>
      )}
    </div>
  );
}
