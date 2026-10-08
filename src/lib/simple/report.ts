import "server-only";

import type { ValueGrid } from "./estimate";
import {
  getAskingBand,
  getGrowthCurve,
  getListings,
  getSoldBand,
  getTraitUpgrades,
  getValueGrid,
  traitsFromSlugs,
  type GrowthPoint,
  type Morph,
} from "./data";
import { encodeReportKey, type ReportState } from "./report-state";
import type { ValueReportData } from "./report-types";

function growthUsable(points: GrowthPoint[]): boolean {
  const bySex = new Map<string, number>();
  for (const p of points) if (p.n >= 6 && p.sex !== "all") bySex.set(p.sex, (bySex.get(p.sex) ?? 0) + 1);
  return [...bySex.values()].some((c) => c >= 3);
}

function entries(grid: ValueGrid): ValueReportData["grid"] {
  return [...grid.entries()];
}

/** One value report. Callers pass the morph list when they already loaded it. */
export async function loadValueReport(input: ReportState, morphs: Morph[]): Promise<ValueReportData> {
  const selected = traitsFromSlugs(morphs, input.slugs);
  const traits = selected.map((m) => m.trait);
  const sex = input.sex;
  const age = input.age;

  const [grid, market, growth, marketGrowth, upgrades, sold, asking, comps, recentSold] = await Promise.all([
    getValueGrid(traits),
    traits.length ? getValueGrid([]) : Promise.resolve(null),
    getGrowthCurve(traits),
    traits.length ? getGrowthCurve([]) : Promise.resolve(null),
    getTraitUpgrades(traits),
    getSoldBand(traits),
    getAskingBand(traits),
    getListings({
      traits,
      status: "for-sale",
      sex: sex === "male" || sex === "female" ? sex : null,
      age,
      sort: "value",
      limit: 8,
    }),
    getListings({ traits, status: "sold", sort: "newest", limit: 4 }),
  ]);

  const marketGrid = market ?? grid;
  const growthPoints = growthUsable(growth) ? growth : marketGrowth ?? growth;

  return {
    requestKey: encodeReportKey(input),
    slugs: selected.map((m) => m.slug),
    sex,
    age,
    traits,
    grid: entries(grid),
    marketGrid: entries(marketGrid),
    growth: growthPoints,
    growthIsMarket: growthPoints !== growth,
    upgrades,
    sold,
    asking,
    comps,
    recentSold,
  };
}
