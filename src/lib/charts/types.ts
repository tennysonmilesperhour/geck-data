// Chart registry / settings types.
//
// A ChartDef is a self-contained piece of metadata + render function. Pages
// consume charts through <ChartGrid> which looks up IDs in the registry. The
// settings panel also drives off the registry so toggles / presets stay in
// sync with what's actually shippable.
import type { ReactElement } from "react";

export type PageId =
  | "home"
  | "sold"
  | "sellers"
  | "price-drops"
  | "shows"
  | "cross-platform"
  | "trends"
  | "market"
  | "compare";

export type ChartCategory =
  | "price"
  | "traits"
  | "sellers"
  | "activity"
  | "geo"
  | "relationships";

// Each page has a known "context" shape — the data the page has already
// fetched server-side. Charts registered to that page must declare
// compatibility via the `pages` list and will receive this shape.
export type PageContexts = {
  home: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listings: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sellers: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    soldEvents: any[];
  };
  sellers: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sellers: any[];
  };
  sold: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    soldRows: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    soldEvents: any[];
  };
};

// A ChartDef<P> is keyed to a single page's context. In the registry we
// widen to `unknown` so heterogeneous entries can live in one map.
export type ChartDef<P extends PageId = PageId> = {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  category: ChartCategory;
  pages: P[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (ctx: any) => ReactElement;
};

// Planned-but-not-yet-implemented charts surface in the settings panel so
// users can see what's coming. No render fn — greyed out in the UI.
export type PlannedChart = {
  id: string;
  title: string;
  description: string;
  category: ChartCategory;
  pages: PageId[];
};

export type ChartPrefs = {
  // Per-page list of chart IDs in the order they should render.
  pages: Partial<Record<PageId, string[]>>;
  // Active preset name ("custom" = user-edited, otherwise one of PRESETS).
  preset: string;
};

export const PREFS_STORAGE_KEY = "geck.charts.prefs.v1";
