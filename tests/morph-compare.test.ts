import assert from "node:assert/strict";
import test from "node:test";
import type { AtlasListing, AtlasMorph, AtlasPriceObservation } from "../src/components/design-lab/atlas-types";
import { buildMorphComparison, pairOverlap, quantile } from "../src/lib/market/morph-compare";

const morphs: AtlasMorph[] = [
  { name: "Lilly White", category: "color", aliases: ["lily white"], description: null },
  { name: "Harlequin", category: "pattern", aliases: [], description: null },
  { name: "Axanthic", category: "color", aliases: [], description: null },
];

const listing = (
  id: string,
  price: number,
  traits: string[],
  sellerId: string,
  maturity: string | null = "Adult",
  sex: string | null = "female",
): AtlasListing => ({
  id,
  title: id,
  price,
  traits,
  sellerId,
  maturity,
  sex,
  firstListedAt: "2026-08-27T00:00:00Z",
  firstSeenAt: "2026-08-27T00:00:00Z",
  lastSeenAt: "2026-08-30T00:00:00Z",
  imageUrl: null,
});

const listings = [
  listing("a", 300, ["Lilly White", "Harlequin"], "s1"),
  listing("b", 500, ["Lilly White"], "s2", "Juvenile", "male"),
  listing("c", 200, ["Harlequin"], "s1"),
  listing("d", 400, ["Axanthic"], "s3", null, null),
];

const observations: AtlasPriceObservation[] = [
  { listingId: "a", date: "2026-08-28", price: 320 },
  { listingId: "a", date: "2026-08-30", price: 300 },
  { listingId: "b", date: "2026-08-28", price: 500 },
  { listingId: "b", date: "2026-08-30", price: 500 },
  { listingId: "c", date: "2026-08-28", price: 200 },
  { listingId: "c", date: "2026-08-30", price: 180 },
];

test("quantile uses continuous interpolation", () => {
  assert.equal(quantile([100, 200, 300, 400], 0.25), 175);
  assert.equal(quantile([100, 200, 300, 400], 0.5), 250);
  assert.equal(quantile([], 0.5), null);
});

test("contains scope keeps overlaps visible and attaches breadth", () => {
  const result = buildMorphComparison(
    morphs,
    ["Lilly White", "Harlequin"],
    listings,
    observations,
    { scope: "contains", maturity: "All", sex: "All" },
    "2026-08-30T00:00:00Z",
    192,
    ["2026-08-28", "2026-08-29", "2026-08-30"],
  );
  const lilly = result.metrics[0]!;
  const harlequin = result.metrics[1]!;
  assert.equal(result.filteredListingCount, 4);
  assert.equal(result.traitResolvedCount, 4);
  assert.equal(result.traitCoveragePct, 100);
  assert.equal(lilly.listingCount, 2);
  assert.equal(lilly.sellerCount, 2);
  assert.equal(lilly.median, 400);
  assert.equal(lilly.coTraits[0]?.name, "Harlequin");
  assert.deepEqual(pairOverlap(lilly, harlequin), { count: 1, shareOfSmaller: 50 });
});

test("trait coverage exposes uncoded rows without removing them from contains scope", () => {
  const result = buildMorphComparison(
    morphs,
    ["Lilly White"],
    [...listings, { ...listings[0]!, id: "uncoded", traits: [] }],
    observations,
    { scope: "contains", maturity: "All", sex: "All" },
    "2026-08-30T00:00:00Z",
    192,
    ["2026-08-28", "2026-08-29", "2026-08-30"],
  );

  assert.equal(result.filteredListingCount, 5);
  assert.equal(result.cohortCount, 5);
  assert.equal(result.traitResolvedCount, 4);
  assert.equal(result.traitCoveragePct, 80);
  assert.equal(result.metrics[0]?.listingCount, 2);
});

test("only scope removes multi-trait listings from each morph and cohort", () => {
  const result = buildMorphComparison(
    morphs,
    ["Lilly White", "Harlequin"],
    listings,
    observations,
    { scope: "only", maturity: "All", sex: "All" },
    "2026-08-30T00:00:00Z",
    192,
    ["2026-08-28", "2026-08-30"],
  );
  assert.equal(result.cohortCount, 3);
  assert.equal(result.metrics[0]?.listingCount, 1);
  assert.equal(result.metrics[1]?.listingCount, 1);
  assert.equal(pairOverlap(result.metrics[0]!, result.metrics[1]!).count, 0);
});

test("dimension filters and same-listing momentum use the selected population", () => {
  const result = buildMorphComparison(
    morphs,
    ["Lilly White", "Harlequin"],
    listings,
    observations,
    { scope: "contains", maturity: "Adult", sex: "Female" },
    "2026-08-30T00:00:00Z",
    192,
    ["2026-08-28", "2026-08-30"],
  );
  assert.equal(result.cohortCount, 2);
  assert.equal(result.metrics[0]?.listingCount, 1);
  assert.equal(result.metrics[0]?.momentumCount, 1);
  assert.equal(Math.round(result.metrics[0]?.momentumPct ?? 0), -6);
});
