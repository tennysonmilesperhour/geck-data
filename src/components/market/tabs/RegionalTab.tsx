"use client";
// Regional tab body. Owns the metric + selected cell state; defers the
// heatmap render to RegionalHeatmap.
import { useMemo, useState } from "react";
import type { Filters } from "@/lib/market/types";
import type { HeatmapMetric, RegionKey } from "@/lib/market/fixtures";
import { getRegionalHeatmap } from "@/lib/market/fixtures";
import RegionalHeatmap from "@/components/market/widgets/RegionalHeatmap";

export default function RegionalTab({ filters }: { filters: Filters }) {
  const [metric, setMetric] = useState<HeatmapMetric>("medianSold");
  const [selected, setSelected] = useState<
    { combo: string; region: RegionKey } | null
  >(null);
  const data = useMemo(
    () => getRegionalHeatmap(filters, metric),
    [filters, metric],
  );

  return (
    <RegionalHeatmap
      data={data}
      metric={metric}
      onMetricChange={setMetric}
      selected={selected}
      onSelect={setSelected}
    />
  );
}
