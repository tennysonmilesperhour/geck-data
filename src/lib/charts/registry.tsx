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
import type { ChartDef, PlannedChart } from "./types";

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
    pages: ["home"],
    render: (ctx) => <SellerLeaderboardScatter data={ctx.sellers as Seller[]} />,
  },
};

// Forward-looking menu of charts the settings panel can surface as
// "coming soon." Moved into CHART_REGISTRY when implemented.
export const PLANNED_CHARTS: PlannedChart[] = [
  {
    id: "geo-map-sellers",
    title: "Seller geo map",
    description: "Choropleth of sellers by US state / country.",
    category: "geo",
    pages: ["home", "sellers"],
  },
  {
    id: "box-plot-price-by-trait",
    title: "Price box plot by trait",
    description:
      "Box-and-whisker plots of price distribution per major trait — surfaces premium traits.",
    category: "traits",
    pages: ["home"],
  },
  {
    id: "treemap-market-share",
    title: "Market share treemap",
    description: "Nested rectangles sized by listings or revenue per seller.",
    category: "sellers",
    pages: ["home", "sellers"],
  },
  {
    id: "sunburst-taxonomy",
    title: "Species → morph sunburst",
    description: "Radial drilldown from species through morphs to individual traits.",
    category: "traits",
    pages: ["home"],
  },
  {
    id: "force-graph-trait-cooccurrence",
    title: "Trait co-occurrence network",
    description:
      "Force-directed graph of which traits tend to appear together on the same listings.",
    category: "relationships",
    pages: ["home"],
  },
  {
    id: "calendar-heatmap",
    title: "Listing activity calendar",
    description: "GitHub-style calendar heatmap of daily listing activity.",
    category: "activity",
    pages: ["home", "trends"],
  },
  {
    id: "cumulative-sales",
    title: "Cumulative sales over time",
    description: "Stacked area chart showing cumulative sold listings by seller tier.",
    category: "activity",
    pages: ["home", "sold"],
  },
  {
    id: "bubble-chart-sellers",
    title: "Seller inventory vs price bubble chart",
    description:
      "Per-seller bubbles: x = listings live, y = avg price, size = sold count.",
    category: "sellers",
    pages: ["home", "sellers"],
  },
  {
    id: "price-heatmap-hour-weekday",
    title: "Post-activity heatmap",
    description:
      "Hour of day × day of week grid showing when new listings typically appear.",
    category: "activity",
    pages: ["home", "trends"],
  },
  {
    id: "ridge-plot-price-by-trait",
    title: "Price ridge plot",
    description:
      "Overlapping density curves of price distributions across traits — easier to compare shape than box plots.",
    category: "price",
    pages: ["home"],
  },
];

export function isImplemented(id: string): boolean {
  return id in CHART_REGISTRY;
}
