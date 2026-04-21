"use client";
// Regional tab body. Owns the metric + selected cell state; defers the
// heatmap render to RegionalHeatmap. Reads live data via queries.ts.
import { useState } from "react";
import type { Filters } from "@/lib/market/types";
import type { HeatmapMetric, RegionKey } from "@/lib/market/fixtures";
import { fetchRegionalHeatmap } from "@/lib/market/queries";
import { useFilteredQuery } from "@/lib/market/useFilteredQuery";
import RegionalHeatmap from "@/components/market/widgets/RegionalHeatmap";

export default function RegionalTab({ filters }: { filters: Filters }) {
  const [metric, setMetric] = useState<HeatmapMetric>("medianSold");
  const [selected, setSelected] = useState<
    { combo: string; region: RegionKey } | null
  >(null);
  const q = useFilteredQuery(
    fetchRegionalHeatmap,
    filters,
    [metric] as const,
    metric,
  );

  if (!q.data) {
    return (
      <div className="forest-surface p-6 text-sm text-forest-400">
        Loading regional heatmap…
      </div>
    );
  }

  return (
    <RegionalHeatmap
      data={q.data}
      metric={metric}
      onMetricChange={setMetric}
      selected={selected}
      onSelect={setSelected}
      status={q.status}
      note={q.note}
    />
  );
}
