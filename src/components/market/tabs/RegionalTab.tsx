"use client";
// Regional tab body. Owns the metric + selected cell state; defers the
// heatmap render to RegionalHeatmap. Reads live data via queries.ts.
import { useState } from "react";
import type { Filters } from "@/lib/market/types";
import type { HeatmapMetric, RegionKey } from "@/lib/market/widget-types";
import { fetchRegionalHeatmap } from "@/lib/market/queries";
import { useFilteredQuery } from "@/lib/market/useFilteredQuery";
import EmptyState from "@/components/market/EmptyState";
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
      <EmptyState
        status={q.status}
        label="Regional heatmap"
        note={q.note}
      />
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
