"use client";
// Composes the Overview widgets:
//   [                   Market Index (hero, full width)                  ]
//   [                   Top Movers (full width)                           ]
//   [                    Peak Indicator grid (full width)                ]
//
// Each widget reads real data via the queries module; when a view is
// empty or missing, the widget renders an EmptyState rather than a
// synthetic fixture. Market Sub-Indices stays hidden entirely while
// no v_market_sub_index view exists.
import {
  fetchMarketIndex,
  fetchMarketSubIndices,
  fetchPeakIndicators,
  fetchTopMovers,
} from "@/lib/market/queries";
import { useFilteredQuery } from "@/lib/market/useFilteredQuery";
import type { Filters, SourceId } from "@/lib/market/types";
import EmptyState from "@/components/market/EmptyState";
import MarketIndexCard from "@/components/market/widgets/MarketIndexCard";
import MarketSubIndices from "@/components/market/widgets/MarketSubIndices";
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
  const subIndicesQ = useFilteredQuery(
    fetchMarketSubIndices,
    filters,
    [] as const,
  );
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
        <EmptyState
          status={indexQ.status}
          label="Market Index"
          note={indexQ.note}
        />
      )}

      {subIndicesQ.data && subIndicesQ.data.length > 0 ? (
        <MarketSubIndices
          data={subIndicesQ.data}
          onSelectCombo={onSelectCombo}
          status={subIndicesQ.status}
          note={subIndicesQ.note}
        />
      ) : null}

      {moversQ.data ? (
        <TopMoversPanel
          appreciating={moversQ.data.appreciating}
          depreciating={moversQ.data.depreciating}
          onSelectCombo={onSelectCombo}
          status={moversQ.status}
          note={moversQ.note}
        />
      ) : (
        <EmptyState
          status={moversQ.status}
          label="Top Movers"
          note={moversQ.note}
        />
      )}

      {peaksQ.data ? (
        <PeakIndicatorGrid
          indicators={peaksQ.data}
          status={peaksQ.status}
          note={peaksQ.note}
        />
      ) : (
        <EmptyState
          status={peaksQ.status}
          label="Peak Indicator"
          note={peaksQ.note}
        />
      )}
    </div>
  );
}
