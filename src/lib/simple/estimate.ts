// Turns the value grids into one estimate for one gecko.
//
// Order of preference, most specific first:
//   1. The exact cell (these morphs, this age, this sex) when it has
//      enough listings.
//   2. These morphs overall, adjusted by how much age and sex move prices
//      across the whole crested market. This is how Kelley Blue Book
//      adjusts a base value for options: the base comes from the specific
//      model, the adjustment from the whole market.
// The result always says which path it took and how many listings it
// rests on, so the page can tell the reader.

export type AgeClass = "hatchling" | "juvenile" | "subadult" | "adult";
export type SexClass = "female" | "male" | "unsexed";
export const AGE_CLASSES: AgeClass[] = ["hatchling", "juvenile", "subadult", "adult"];
export const SEX_CLASSES: SexClass[] = ["female", "male", "unsexed"];

export type GridCell = { n: number; p25: number | null; p50: number | null; p75: number | null };
/** Keyed "age|sex"; either side may be "any". */
export type ValueGrid = Map<string, GridCell>;

export const gridKey = (age: AgeClass | "any", sex: SexClass | "any") => `${age}|${sex}`;

export const MIN_CELL = 5;

export type Estimate = {
  low: number;
  mid: number;
  high: number;
  n: number;
  basis: "exact" | "adjusted" | "morph-only";
  /** Multiplier applied for age and sex on the adjusted path. */
  factor: number | null;
};

const usable = (c: GridCell | undefined): c is GridCell & { p25: number; p50: number; p75: number } =>
  !!c && c.n >= MIN_CELL && c.p25 != null && c.p50 != null && c.p75 != null;

export function estimate(
  grid: ValueGrid,
  market: ValueGrid,
  age: AgeClass | null,
  sex: SexClass | null,
): Estimate | null {
  const a = age ?? "any";
  const s = sex ?? "any";

  const exact = grid.get(gridKey(a, s));
  if (usable(exact)) {
    return {
      low: exact.p25,
      mid: exact.p50,
      high: exact.p75,
      n: exact.n,
      basis: a === "any" && s === "any" ? "morph-only" : "exact",
      factor: null,
    };
  }

  const base = grid.get(gridKey("any", "any"));
  if (!usable(base)) return null;

  const marketCell = market.get(gridKey(a, s));
  const marketAll = market.get(gridKey("any", "any"));
  const factor =
    usable(marketCell) && usable(marketAll) ? marketCell.p50 / marketAll.p50 : null;
  if (factor == null) {
    return { low: base.p25, mid: base.p50, high: base.p75, n: base.n, basis: "morph-only", factor: null };
  }
  const round = (v: number) => Math.round(v / 5) * 5;
  return {
    low: round(base.p25 * factor),
    mid: round(base.p50 * factor),
    high: round(base.p75 * factor),
    n: base.n,
    basis: "adjusted",
    factor,
  };
}

export const AGE_LABEL: Record<AgeClass, string> = {
  hatchling: "Hatchling",
  juvenile: "Juvenile",
  subadult: "Subadult",
  adult: "Adult",
};

export const SEX_LABEL: Record<SexClass, string> = {
  female: "Female",
  male: "Male",
  unsexed: "Not sexed",
};
