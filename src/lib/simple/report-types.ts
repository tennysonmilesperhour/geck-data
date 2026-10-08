import type { AgeClass, SexClass } from "./estimate";
import type { GrowthPoint, Listing, PriceBand, Upgrade } from "./data";

export type GridCell = { n: number; p25: number | null; p50: number | null; p75: number | null };
export type GridEntries = Array<[string, GridCell]>;

/** JSON report for one gecko. Maps are entry lists so the route can cache it. */
export type ValueReportData = {
  /** Echo of the requested filters, after the same parsing the client uses. */
  requestKey: string;
  slugs: string[];
  sex: SexClass | null;
  age: AgeClass | null;
  traits: string[];
  grid: GridEntries;
  marketGrid: GridEntries;
  growth: GrowthPoint[];
  growthIsMarket: boolean;
  upgrades: Upgrade[];
  sold: PriceBand | null;
  asking: PriceBand | null;
  comps: { rows: Listing[]; total: number };
  recentSold: { rows: Listing[]; total: number };
};
