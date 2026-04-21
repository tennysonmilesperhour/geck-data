"use client";
// Combos tab. Two-column layout:
//   Left (2/3)  — RankedCombosTable, sortable, click-to-select
//   Right (1/3) — ComboDetailPanel with headline, multi-line chart, blend,
//                 key metrics
import { useEffect, useMemo, useState } from "react";
import {
  getCombosRanked,
  getComboDetail,
  type ComboRankSort,
} from "@/lib/market/fixtures";
import type { Filters } from "@/lib/market/types";
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
  const rows = useMemo(() => getCombosRanked(filters, sort), [filters, sort]);

  // Auto-pick a reasonable default when the tab mounts or the filters change
  // in a way that removes the previous selection from the list.
  useEffect(() => {
    if (rows.length === 0) return;
    if (!selectedCombo || !rows.find((r) => r.combo === selectedCombo)) {
      onSelectCombo(rows[0]!.combo);
    }
  }, [rows, selectedCombo, onSelectCombo]);

  const detail = useMemo(
    () => getComboDetail(filters, selectedCombo as never),
    [filters, selectedCombo],
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <RankedCombosTable
          rows={rows}
          sort={sort}
          onSortChange={setSort}
          selected={selectedCombo}
          onSelect={onSelectCombo}
        />
      </div>
      <div className="xl:col-span-1">
        <ComboDetailPanel detail={detail} />
      </div>
    </div>
  );
}
