// Named preset configurations. A preset maps each page to an ordered list of
// chart IDs. IDs that aren't in CHART_REGISTRY yet are silently skipped by
// <ChartGrid>, so presets can reference future charts safely.
import type { PageId } from "./types";

export type Preset = {
  id: string;
  name: string;
  description: string;
  pages: Partial<Record<PageId, string[]>>;
};

export const PRESETS: Preset[] = [
  {
    id: "market-pulse",
    name: "Market Pulse",
    description:
      "Broad overview of pricing, traits, and seller distribution — the classic dashboard.",
    pages: {
      home: ["price-histogram", "trait-freq-price", "seller-scatter"],
      sellers: ["seller-scatter", "bubble-chart-sellers"],
      sold: ["cumulative-sales", "days-to-sell"],
    },
  },
  {
    id: "sales-analyst",
    name: "Sales Analyst",
    description:
      "Focused on throughput: what's selling, how fast, and where prices are moving.",
    pages: {
      home: [
        "price-histogram",
        "cumulative-sales",
        "stacked-area-listings",
        "calendar-heatmap",
        "treemap-market-share",
      ],
      sellers: ["bubble-chart-sellers", "treemap-market-share"],
      sold: ["days-to-sell", "cumulative-sales"],
    },
  },
  {
    id: "seller-deep-dive",
    name: "Seller Deep-Dive",
    description:
      "Emphasizes seller-level comparisons, geography, and activity patterns.",
    pages: {
      home: [
        "seller-scatter",
        "bubble-chart-sellers",
        "geo-map-sellers",
        "calendar-heatmap",
      ],
      sellers: [
        "seller-scatter",
        "bubble-chart-sellers",
        "treemap-market-share",
        "geo-map-sellers",
      ],
      sold: ["cumulative-sales"],
    },
  },
  {
    id: "trait-explorer",
    name: "Trait Explorer",
    description:
      "Built around trait frequency, relationships, and price premiums.",
    pages: {
      home: [
        "trait-freq-price",
        "box-plot-price-by-trait",
        "ridge-plot-price-by-trait",
        "sunburst-taxonomy",
        "force-graph-trait-cooccurrence",
      ],
      sellers: ["seller-scatter"],
      sold: ["cumulative-sales"],
    },
  },
];

export const DEFAULT_PRESET_ID = "market-pulse";

export function presetById(id: string): Preset | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}
