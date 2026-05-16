"use client";
// Combos tab. Two-column layout:
//   Left (2/3)  — RankedCombosTable, sortable, click-to-select
//   Right (1/3) — ComboDetailPanel with headline, multi-line chart, blend,
//                 key metrics
//
// Both sides read live data via queries.ts and show an empty state if
// the underlying view returns nothing. LivePreviewTag on each panel
// surfaces live vs preview status.
import { useEffect, useState } from "react";
import { fetchComboDetail, fetchCombosRanked } from "@/lib/market/queries";
import { useFilteredQuery } from "@/lib/market/useFilteredQuery";
import type { ComboRankSort } from "@/lib/market/widget-types";
import type { Filters } from "@/lib/market/types";
import EmptyState from "@/components/market/EmptyState";
import RankedCombosTable from "@/components/market/widgets/RankedCombosTable";
import ComboDetailPanel from "@/components/market/widgets/ComboDetailPanel";

export default function CombosTab({
  filters,
  selectedCombo,
  onSelectCombo,
}: {
  filters: Filters;
  selectedCombo: string | null;
  onSelectCombo: (combo: string | null) => void;
}) {
  const [sort, setSort] = useState<ComboRankSort>("volume");
  const rowsQ = useFilteredQuery(
    fetchCombosRanked,
    filters,
    [sort] as const,
    sort, // key string in useFilteredQuery's dep array
  );
  const detailQ = useFilteredQuery(
    fetchComboDetail,
    filters,
    [selectedCombo] as const,
    selectedCombo ?? "",
  );

  // Auto-pick a reasonable default when the list resolves and nothing is
  // selected (or the previous selection is no longer in the table).
  useEffect(() => {
    const rows = rowsQ.data;
    if (!rows || rows.length === 0) return;
    if (!selectedCombo || !rows.find((r) => r.combo === selectedCombo)) {
      onSelectCombo(rows[0]!.combo);
    }
  }, [rowsQ.data, selectedCombo, onSelectCombo]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        {rowsQ.data ? (
          <RankedCombosTable
            rows={rowsQ.data}
            sort={sort}
            onSortChange={setSort}
            selected={selectedCombo}
            onSelect={onSelectCombo}
            status={rowsQ.status}
            note={rowsQ.note}
          />
        ) : (
          <EmptyState
            status={rowsQ.status}
            label="Combos"
            note={rowsQ.note}
          />
        )}
      </div>
      <div className="xl:col-span-1">
        <ComboDetailPanel
          detail={detailQ.data ?? null}
          status={detailQ.status}
          note={detailQ.note}
        />
      </div>
    </div>
  );
}
