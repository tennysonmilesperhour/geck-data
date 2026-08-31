import type {
  AtlasListing,
  AtlasMorph,
  AtlasPriceObservation,
} from "@/components/design-lab/atlas-types";

export type ComparisonScope = "contains" | "only";
export type ComparisonConfidence = "Strong" | "Moderate" | "Thin" | "No data";

export type MorphComparisonFilters = {
  scope: ComparisonScope;
  maturity: string;
  sex: string;
};

export type MixSlice = {
  label: string;
  count: number;
  share: number;
};

export type CoTrait = {
  name: string;
  count: number;
  share: number;
};

export type TrendPoint = {
  date: string;
  median: number | null;
  count: number;
};

export type MorphComparisonMetric = {
  morph: AtlasMorph;
  listingCount: number;
  pricedCount: number;
  sellerCount: number;
  sellerCoveragePct: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  premiumPct: number | null;
  marketSharePct: number;
  topSellerSharePct: number | null;
  newArrivalCount: number;
  medianDaysListed: number | null;
  maturityReportedPct: number;
  sexReportedPct: number;
  maturityMix: ReadonlyArray<MixSlice>;
  sexMix: ReadonlyArray<MixSlice>;
  coTraits: ReadonlyArray<CoTrait>;
  confidence: ComparisonConfidence;
  trend: ReadonlyArray<TrendPoint>;
  momentumPct: number | null;
  momentumCount: number;
  observedDays: number;
  listingIds: ReadonlySet<string>;
};

export type MorphComparisonResult = {
  filteredListingCount: number;
  cohortCount: number;
  cohortPricedCount: number;
  traitResolvedCount: number;
  traitCoveragePct: number;
  marketMedian: number | null;
  metrics: ReadonlyArray<MorphComparisonMetric>;
};

const MATURITY_ORDER = ["Baby", "Juvenile", "Subadult", "Adult", "Unreported"];
const SEX_ORDER = ["Male", "Female", "Unreported"];

function cleanDimension(value: string | null, kind: "maturity" | "sex"): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || normalized === "unknown" || normalized === "unsexed") return "Unreported";
  if (kind === "sex") {
    if (normalized.startsWith("m")) return "Male";
    if (normalized.startsWith("f")) return "Female";
    return "Unreported";
  }
  if (normalized.includes("baby") || normalized.includes("hatch")) return "Baby";
  if (normalized.includes("juven")) return "Juvenile";
  if (normalized.includes("sub")) return "Subadult";
  if (normalized.includes("adult") || normalized.includes("breed")) return "Adult";
  return "Unreported";
}

export function quantile(values: ReadonlyArray<number>, q: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const position = Math.max(0, Math.min(1, q)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function validPrice(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0 && value < 100_000;
}

function passesDimensionFilters(listing: AtlasListing, filters: MorphComparisonFilters): boolean {
  const maturity = cleanDimension(listing.maturity, "maturity");
  const sex = cleanDimension(listing.sex, "sex");
  return (filters.maturity === "All" || maturity === filters.maturity)
    && (filters.sex === "All" || sex === filters.sex);
}

export function listingContainsMorph(
  listing: AtlasListing,
  morphName: string,
  scope: ComparisonScope,
): boolean {
  const contains = listing.traits.includes(morphName);
  return contains && (scope === "contains" || listing.traits.length === 1);
}

function mix(rows: ReadonlyArray<AtlasListing>, kind: "maturity" | "sex"): MixSlice[] {
  const order = kind === "maturity" ? MATURITY_ORDER : SEX_ORDER;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = cleanDimension(kind === "maturity" ? row.maturity : row.sex, kind);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return order.map((label) => {
    const count = counts.get(label) ?? 0;
    return { label, count, share: rows.length > 0 ? (count / rows.length) * 100 : 0 };
  });
}

function confidence(pricedCount: number, sellerCount: number): ComparisonConfidence {
  if (pricedCount === 0) return "No data";
  if (pricedCount >= 30 && sellerCount >= 10) return "Strong";
  if (pricedCount >= 10 && sellerCount >= 5) return "Moderate";
  return "Thin";
}

function buildTrend(
  listingIds: ReadonlySet<string>,
  observations: ReadonlyArray<AtlasPriceObservation>,
  dates: ReadonlyArray<string>,
): { points: TrendPoint[]; momentumPct: number | null; momentumCount: number } {
  const pricesByDay = new Map<string, number[]>();
  const pricesByListing = new Map<string, AtlasPriceObservation[]>();
  for (const observation of observations) {
    if (!listingIds.has(observation.listingId) || !validPrice(observation.price)) continue;
    const dayPrices = pricesByDay.get(observation.date) ?? [];
    dayPrices.push(observation.price);
    pricesByDay.set(observation.date, dayPrices);
    const listingPrices = pricesByListing.get(observation.listingId) ?? [];
    listingPrices.push(observation);
    pricesByListing.set(observation.listingId, listingPrices);
  }
  const changes: number[] = [];
  for (const listingPrices of pricesByListing.values()) {
    const sorted = [...listingPrices].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0]?.price;
    const last = sorted.at(-1)?.price;
    if (sorted.length < 2 || !first || last === undefined) continue;
    changes.push(((last - first) / first) * 100);
  }
  return {
    points: dates.map((date) => {
      const prices = pricesByDay.get(date) ?? [];
      return { date, median: quantile(prices, 0.5), count: prices.length };
    }),
    momentumPct: quantile(changes, 0.5),
    momentumCount: changes.length,
  };
}

export function buildMorphComparison(
  morphs: ReadonlyArray<AtlasMorph>,
  selectedNames: ReadonlyArray<string>,
  listings: ReadonlyArray<AtlasListing>,
  observations: ReadonlyArray<AtlasPriceObservation>,
  filters: MorphComparisonFilters,
  nowIso: string,
  currentWindowHours: number,
  observationDates: ReadonlyArray<string>,
): MorphComparisonResult {
  const dimensionRows = listings.filter((listing) => passesDimensionFilters(listing, filters));
  const cohortRows = filters.scope === "only"
    ? dimensionRows.filter((listing) => listing.traits.length === 1)
    : dimensionRows;
  const traitResolvedCount = dimensionRows.filter((listing) => listing.traits.length > 0).length;
  const cohortPrices = cohortRows.map((row) => row.price).filter(validPrice);
  const marketMedian = quantile(cohortPrices, 0.5);
  const morphByName = new Map(morphs.map((morph) => [morph.name, morph]));
  const now = Number.isFinite(Date.parse(nowIso)) ? Date.parse(nowIso) : Date.now();
  const arrivalCutoff = now - currentWindowHours * 3_600_000;

  const metrics = selectedNames.map((name) => {
    const morph = morphByName.get(name) ?? { name, category: "other", aliases: [], description: null };
    const rows = dimensionRows.filter((listing) => listingContainsMorph(listing, name, filters.scope));
    const prices = rows.map((row) => row.price).filter(validPrice);
    const sellers = new Set(rows.map((row) => row.sellerId).filter((id): id is string => Boolean(id)));
    const sellerRows = rows.filter((row) => Boolean(row.sellerId));
    const sellerCounts = new Map<string, number>();
    for (const row of sellerRows) {
      if (!row.sellerId) continue;
      sellerCounts.set(row.sellerId, (sellerCounts.get(row.sellerId) ?? 0) + 1);
    }
    const topSellerCount = Math.max(0, ...sellerCounts.values());
    const coTraitCounts = new Map<string, number>();
    for (const row of rows) {
      for (const trait of row.traits) {
        if (trait === name) continue;
        coTraitCounts.set(trait, (coTraitCounts.get(trait) ?? 0) + 1);
      }
    }
    const maturityMix = mix(rows, "maturity");
    const sexMix = mix(rows, "sex");
    const listedDays = rows
      .map((row) => row.firstListedAt ?? row.firstSeenAt)
      .filter((value): value is string => Boolean(value))
      .map((value) => Math.max(0, (now - Date.parse(value)) / 86_400_000))
      .filter(Number.isFinite);
    const listingIds = new Set(rows.map((row) => row.id));
    const trend = buildTrend(listingIds, observations, observationDates);
    const median = quantile(prices, 0.5);
    return {
      morph,
      listingCount: rows.length,
      pricedCount: prices.length,
      sellerCount: sellers.size,
      sellerCoveragePct: rows.length > 0 ? (sellerRows.length / rows.length) * 100 : 0,
      median,
      p25: quantile(prices, 0.25),
      p75: quantile(prices, 0.75),
      premiumPct: median !== null && marketMedian !== null && marketMedian > 0
        ? ((median - marketMedian) / marketMedian) * 100
        : null,
      marketSharePct: cohortRows.length > 0 ? (rows.length / cohortRows.length) * 100 : 0,
      topSellerSharePct: rows.length > 0 && topSellerCount > 0 ? (topSellerCount / rows.length) * 100 : null,
      newArrivalCount: rows.filter((row) => {
        const value = row.firstListedAt ?? row.firstSeenAt;
        return value ? Date.parse(value) >= arrivalCutoff : false;
      }).length,
      medianDaysListed: quantile(listedDays, 0.5),
      maturityReportedPct: rows.length > 0
        ? ((rows.length - (maturityMix.find((slice) => slice.label === "Unreported")?.count ?? 0)) / rows.length) * 100
        : 0,
      sexReportedPct: rows.length > 0
        ? ((rows.length - (sexMix.find((slice) => slice.label === "Unreported")?.count ?? 0)) / rows.length) * 100
        : 0,
      maturityMix,
      sexMix,
      coTraits: [...coTraitCounts.entries()]
        .map(([trait, count]) => ({ trait, count }))
        .sort((a, b) => b.count - a.count || a.trait.localeCompare(b.trait))
        .slice(0, 5)
        .map(({ trait, count }) => ({ name: trait, count, share: rows.length > 0 ? (count / rows.length) * 100 : 0 })),
      confidence: confidence(prices.length, sellers.size),
      trend: trend.points,
      momentumPct: trend.momentumPct,
      momentumCount: trend.momentumCount,
      observedDays: trend.points.filter((point) => point.count > 0).length,
      listingIds,
    } satisfies MorphComparisonMetric;
  });

  return {
    filteredListingCount: dimensionRows.length,
    cohortCount: cohortRows.length,
    cohortPricedCount: cohortPrices.length,
    traitResolvedCount,
    traitCoveragePct: dimensionRows.length > 0 ? (traitResolvedCount / dimensionRows.length) * 100 : 0,
    marketMedian,
    metrics,
  };
}

export function pairOverlap(
  a: MorphComparisonMetric,
  b: MorphComparisonMetric,
): { count: number; shareOfSmaller: number } {
  let count = 0;
  for (const id of a.listingIds) if (b.listingIds.has(id)) count += 1;
  const smaller = Math.min(a.listingCount, b.listingCount);
  return { count, shareOfSmaller: smaller > 0 ? (count / smaller) * 100 : 0 };
}
