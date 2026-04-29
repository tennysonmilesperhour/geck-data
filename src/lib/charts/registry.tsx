// Canonical list of every chart the app can render, plus a list of charts
// that are planned but not yet implemented. Add a new chart by:
//   1. Building its component under src/components/charts/
//   2. Importing it here and adding an entry to CHART_REGISTRY
//   3. Moving its ID from PLANNED_CHARTS (if present) into CHART_REGISTRY
// Presets reference IDs directly — unknown IDs are silently dropped by
// <ChartGrid>, so it's safe to ship a preset that spans the foundation PR
// and future chart-pack PRs.
import PriceHistogram, {
  type Listing,
} from "@/components/charts/PriceHistogram";
import TraitFrequencyAndPrice, {
  type TraitInput,
} from "@/components/charts/TraitFrequencyAndPrice";
import SellerLeaderboardScatter, {
  type Seller,
} from "@/components/charts/SellerLeaderboardScatter";
import BoxPlot, { type BoxPlotInput } from "@/components/charts/BoxPlot";
import Treemap, { type TreemapSeller } from "@/components/charts/Treemap";
import Sunburst, { type SunburstInput } from "@/components/charts/Sunburst";
import BubbleChart, {
  type BubbleSeller,
} from "@/components/charts/BubbleChart";
import GeoMap, { type GeoSeller } from "@/components/charts/GeoMap";
import RidgePlot, { type RidgeInput } from "@/components/charts/RidgePlot";
import ForceGraph, { type ForceInput } from "@/components/charts/ForceGraph";
import CalendarHeatmap, {
  type CalendarInput,
} from "@/components/charts/CalendarHeatmap";
import PriceHeatmap, {
  type PriceHeatmapInput,
} from "@/components/charts/PriceHeatmap";
import CumulativeSales, {
  type SoldEvent,
} from "@/components/charts/CumulativeSales";
import DaysToSellHistogram from "@/components/charts/DaysToSellHistogram";
import StackedArea, {
  type StackedAreaInput,
} from "@/components/charts/StackedArea";
import type { ChartDef, PlannedChart } from "./types";

// Helper: extract the `days_to_sell` series from a /sold ctx so charts
// that registered for both /home and /sold can stay agnostic.
function pickDays(ctx: { soldRows?: { days_to_sell: number | null }[] }): number[] {
  return (ctx.soldRows ?? [])
    .map((r) => r.days_to_sell)
    .filter((v): v is number => typeof v === "number" && v >= 0 && v <= 365);
}

export const CHART_REGISTRY: Record<string, ChartDef> = {
  "price-histogram": {
    id: "price-histogram",
    title: "Price distribution",
    subtitle: "Distribution of current listing prices across the full market.",
    description:
      "Histogram of listing prices (USD-equivalent), filterable by maturity and sex. Median line overlaid.",
    category: "price",
    pages: ["home"],
    render: (ctx) => <PriceHistogram data={ctx.listings as Listing[]} />,
  },
  "trait-freq-price": {
    id: "trait-freq-price",
    title: "Trait frequency & median price",
    subtitle:
      "Top 25 traits by count, with the median price of listings where the trait appears.",
    description:
      "Horizontal bar chart of the most common traits alongside a dot for each trait's median listing price.",
    category: "traits",
    pages: ["home"],
    render: (ctx) => (
      <TraitFrequencyAndPrice data={ctx.listings as TraitInput[]} topN={25} />
    ),
  },
  "seller-scatter": {
    id: "seller-scatter",
    title: "Seller leaderboard",
    subtitle:
      "Feedback count versus listings live — scale of reach vs. scale of inventory.",
    description:
      "Scatter plot where x = feedback count (log scale), y = avg listing price, size = total listings, color = membership tier.",
    category: "sellers",
    pages: ["home", "sellers"],
    render: (ctx) => <SellerLeaderboardScatter data={ctx.sellers as Seller[]} />,
  },
  "box-plot-price-by-trait": {
    id: "box-plot-price-by-trait",
    title: "Price distribution by trait",
    subtitle:
      "Box-and-whisker plots showing price spread for the most common traits.",
    description:
      "Box-and-whisker plots of price distribution per major trait — surfaces premium traits.",
    category: "traits",
    pages: ["home"],
    render: (ctx) => <BoxPlot data={ctx.listings as BoxPlotInput[]} />,
  },
  "treemap-market-share": {
    id: "treemap-market-share",
    title: "Market share by seller",
    subtitle: "Nested rectangles sized by total live listings per seller.",
    description:
      "Treemap of the top 30 sellers by inventory, with a remainder bucket for the long tail.",
    category: "sellers",
    pages: ["home", "sellers"],
    render: (ctx) => <Treemap data={ctx.sellers as TreemapSeller[]} />,
  },
  "sunburst-taxonomy": {
    id: "sunburst-taxonomy",
    title: "Trait family sunburst",
    subtitle:
      "Radial drilldown grouping individual traits under a shared first-word family.",
    description:
      "Two-level sunburst: outer ring = individual trait, inner ring = trait family (first token of the trait name).",
    category: "traits",
    pages: ["home"],
    render: (ctx) => <Sunburst data={ctx.listings as SunburstInput[]} />,
  },
  "bubble-chart-sellers": {
    id: "bubble-chart-sellers",
    title: "Seller inventory vs price",
    subtitle:
      "Per-seller bubbles: x = live listings, y = avg price, size = feedback count.",
    description:
      "Companion view to the seller leaderboard scatter — linear listings axis makes the long-tail more legible. Bubble size uses feedback count as a rough stand-in for sold volume.",
    category: "sellers",
    pages: ["home", "sellers"],
    render: (ctx) => <BubbleChart data={ctx.sellers as BubbleSeller[]} />,
  },
  "geo-map-sellers": {
    id: "geo-map-sellers",
    title: "Seller geography",
    subtitle:
      "US choropleth of seller counts, parsed from free-form seller_location strings.",
    description:
      "Albers USA choropleth shaded by seller count. Non-US / unparsed locations are surfaced in a footer caption rather than plotted.",
    category: "geo",
    pages: ["home", "sellers"],
    render: (ctx) => <GeoMap data={ctx.sellers as GeoSeller[]} />,
  },
  "ridge-plot-price-by-trait": {
    id: "ridge-plot-price-by-trait",
    title: "Price ridge plot",
    subtitle:
      "Overlapping density curves of price distribution across the top traits.",
    description:
      "Kernel-density ridges per trait, stacked with overlap for easy shape comparison — complements the box plot when distributions are multi-modal.",
    category: "price",
    pages: ["home"],
    render: (ctx) => <RidgePlot data={ctx.listings as RidgeInput[]} />,
  },
  "force-graph-trait-cooccurrence": {
    id: "force-graph-trait-cooccurrence",
    title: "Trait co-occurrence network",
    subtitle:
      "Force-directed graph: nodes are traits, edges link traits that share listings.",
    description:
      "D3 force simulation of the top 30 traits, with edges weighted by how often the two traits co-appear on the same listing (minimum 5).",
    category: "relationships",
    pages: ["home"],
    render: (ctx) => <ForceGraph data={ctx.listings as ForceInput[]} />,
  },
  "calendar-heatmap": {
    id: "calendar-heatmap",
    title: "Listing activity calendar",
    subtitle: "Daily new-listing counts over the trailing 52 weeks.",
    description:
      "GitHub-style calendar heatmap. Cell color encodes count of listings whose first_seen_at falls on that day; deeper Claude-orange = busier day.",
    category: "activity",
    pages: ["home"],
    render: (ctx) => <CalendarHeatmap data={ctx.listings as CalendarInput[]} />,
  },
  "price-heatmap-hour-weekday": {
    id: "price-heatmap-hour-weekday",
    title: "Post-activity heatmap",
    subtitle:
      "When new listings actually appear — hour of day vs. day of week.",
    description:
      "7×24 grid of new-listing counts bucketed by weekday and hour (local time of the viewer). Useful for spotting seller posting rhythms.",
    category: "activity",
    pages: ["home"],
    render: (ctx) => (
      <PriceHeatmap data={ctx.listings as PriceHeatmapInput[]} />
    ),
  },
  "stacked-area-listings": {
    id: "stacked-area-listings",
    title: "New listings by maturity",
    subtitle:
      "Weekly new listings stacked by maturity bucket — Juvenile / Subadult / Adult / Unknown.",
    description:
      "Stacked area (d3-shape) of weekly new-listing counts over the trailing 26 weeks, partitioned by maturity. Complements the calendar heatmap (per-day total) and cumulative sales (sold side) by exposing the maturity mix of inflow.",
    category: "activity",
    pages: ["home"],
    render: (ctx) => <StackedArea data={ctx.listings as StackedAreaInput[]} />,
  },
  "cumulative-sales": {
    id: "cumulative-sales",
    title: "Cumulative sales",
    subtitle: "Running total of sold listings over the trailing 26 weeks.",
    description:
      "Single-series cumulative area of sold-status listing_status_events bucketed weekly. Hover any week dot for that week's incremental + running total.",
    category: "activity",
    pages: ["home", "sold"],
    render: (ctx) => <CumulativeSales data={ctx.soldEvents as SoldEvent[]} />,
  },
  "days-to-sell": {
    id: "days-to-sell",
    title: "Days-to-sell distribution",
    subtitle: "How long sold listings sat on the market before flipping.",
    description:
      "Histogram of `days_to_sell` from the sold_listings_v view, clamped to 0–365 days. Median line overlaid.",
    category: "activity",
    pages: ["sold"],
    render: (ctx) => <DaysToSellHistogram days={pickDays(ctx)} />,
  },
};

// Forward-looking menu of charts the settings panel can surface as
// "coming soon." Moved into CHART_REGISTRY when implemented.
export const PLANNED_CHARTS: PlannedChart[] = [];

export function isImplemented(id: string): boolean {
  return id in CHART_REGISTRY;
}
