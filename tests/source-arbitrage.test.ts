import assert from "node:assert/strict";
import test from "node:test";
import {
  KR_LABEL,
  SOURCE_ARB_MIN_N,
  US_LABEL,
  buildSourceArbRows,
  comboFromListing,
  combosFromListing,
  looksLikeNonCrested,
  medianUsd,
  payloadFlaggedGroupLot,
  payloadIsSold,
  type SourceAsk,
} from "../src/lib/market/source-arbitrage";

test("medianUsd ignores non-positive values", () => {
  assert.equal(medianUsd([100, 0, -5, 200, 300]), 200);
  assert.equal(medianUsd([]), null);
});

test("comboFromListing uses HIGH_VALUE_COMBOS on traits then title", () => {
  const fromTraits = comboFromListing("Lilly White, Axanthic", "unrelated title");
  assert.equal(fromTraits?.id, "lw-axa");
  const fromTitle = comboFromListing(null, "Cappuccino Full Pinstripe Female");
  assert.equal(fromTitle?.id, "cap-pin");
  assert.equal(comboFromListing("Crowned", "Dark Tricolor"), null);
});

test("looksLikeNonCrested catches gargoyle titles", () => {
  assert.equal(looksLikeNonCrested("Red Super Blotched Gargoyle Gecko"), true);
  assert.equal(looksLikeNonCrested("Lilly White Crested Gecko"), false);
});

test("payloadFlaggedGroupLot reads payload flags", () => {
  assert.equal(payloadFlaggedGroupLot({ is_group_lot: true }), true);
  assert.equal(payloadFlaggedGroupLot({ exclude_from_combo_arb: true }), true);
  assert.equal(payloadFlaggedGroupLot({ is_group_lot: false }), false);
  assert.equal(payloadFlaggedGroupLot(null), false);
});

test("payloadIsSold treats FOR_SALE as a live ask", () => {
  assert.equal(payloadIsSold({ sold: true }), true);
  assert.equal(payloadIsSold({ sale_status: "SOLD" }), true);
  assert.equal(payloadIsSold({ sale_status: "FOR_SALE", sold: false }), false);
  assert.equal(payloadIsSold(null), false);
});

test("buildSourceArbRows hides thin samples and uses medians", () => {
  const kr: SourceAsk[] = [
    { comboId: "lw-axa", comboDisplay: "Lilly White × Axanthic", priceUsd: 100 },
    { comboId: "lw-axa", comboDisplay: "Lilly White × Axanthic", priceUsd: 110 },
  ];
  const us: SourceAsk[] = [
    { comboId: "lw-axa", comboDisplay: "Lilly White × Axanthic", priceUsd: 200 },
    { comboId: "lw-axa", comboDisplay: "Lilly White × Axanthic", priceUsd: 220 },
    { comboId: "lw-axa", comboDisplay: "Lilly White × Axanthic", priceUsd: 240 },
  ];
  assert.equal(buildSourceArbRows(kr, us, SOURCE_ARB_MIN_N).length, 0);

  const krOk: SourceAsk[] = [
    ...kr,
    { comboId: "lw-axa", comboDisplay: "Lilly White × Axanthic", priceUsd: 120 },
  ];
  const rows = buildSourceArbRows(krOk, us, 3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.low.label, KR_LABEL);
  assert.equal(rows[0]!.high.label, US_LABEL);
  assert.equal(rows[0]!.low.tag, "ask");
  assert.equal(rows[0]!.low.n, 3);
  assert.equal(rows[0]!.high.n, 3);
  assert.equal(rows[0]!.low.price, 110);
  assert.equal(rows[0]!.high.price, 220);
  assert.equal(rows[0]!.spreadAbs, 110);
});

test("buildSourceArbRows assigns low/high by which market is cheaper", () => {
  const kr: SourceAsk[] = [
    { comboId: "lw-cap", comboDisplay: "x", priceUsd: 500 },
    { comboId: "lw-cap", comboDisplay: "x", priceUsd: 500 },
    { comboId: "lw-cap", comboDisplay: "x", priceUsd: 500 },
  ];
  const us: SourceAsk[] = [
    { comboId: "lw-cap", comboDisplay: "x", priceUsd: 200 },
    { comboId: "lw-cap", comboDisplay: "x", priceUsd: 200 },
    { comboId: "lw-cap", comboDisplay: "x", priceUsd: 200 },
  ];
  const rows = buildSourceArbRows(kr, us, 3);
  assert.equal(rows[0]!.low.label, US_LABEL);
  assert.equal(rows[0]!.high.label, KR_LABEL);
});

test("combosFromListing expands every trait pair and matches across sources", () => {
  const feedle = combosFromListing("Lilly White, Axanthic, Full Pinstripe");
  const ids = feedle.map((c) => c.id).sort();
  // C(3,2) = 3 pairs, ids are sorted normalized tokens joined with "__".
  assert.deepEqual(ids, [
    "axanthic__lillywhite",
    "axanthic__fullpinstripe".split("__").sort().join("__"),
    "fullpinstripe__lillywhite",
  ].sort());
  // A MorphMarket listing naming the same two morphs lands on the same id,
  // so the two sources group together.
  const mm = combosFromListing("Axanthic, Lilly White");
  assert.equal(mm[0]!.id, "axanthic__lillywhite");
});

test("combosFromListing drops redundant modifier pairs and non-morph tokens", () => {
  // Harlequin is contained in Extreme Harlequin, so that pair is one trait
  // restated and is dropped; Normal/Quad are not morphs.
  const out = combosFromListing("Extreme Harlequin, Harlequin, Normal, Quad, Red");
  const ids = out.map((c) => c.id);
  assert.ok(!ids.some((id) => id.includes("harlequin") && id.split("__").length === 2 && id.split("__").every((t) => t.includes("harlequin"))));
  // Only the real cross-trait pairs survive: {extremeharlequin,red} and
  // {harlequin,red}. Normal and Quad never seed a pair.
  assert.deepEqual(
    ids.sort(),
    ["extremeharlequin__red", "harlequin__red"].sort(),
  );
});

test("combosFromListing returns nothing without a structured trait field", () => {
  assert.deepEqual(combosFromListing(null), []);
  assert.deepEqual(combosFromListing(""), []);
  assert.deepEqual(combosFromListing("Normal"), []);
});

test("buildSourceArbRows groups auto-discovered ids across both sides", () => {
  const kr = [
    { comboId: "axanthic__lillywhite", comboDisplay: "Axanthic × Lilly White", priceUsd: 100 },
    { comboId: "axanthic__lillywhite", comboDisplay: "Axanthic × Lilly White", priceUsd: 100 },
    { comboId: "axanthic__lillywhite", comboDisplay: "Axanthic × Lilly White", priceUsd: 100 },
    // present only on KR -> no row
    { comboId: "cream__yellow", comboDisplay: "Cream × Yellow", priceUsd: 50 },
    { comboId: "cream__yellow", comboDisplay: "Cream × Yellow", priceUsd: 50 },
    { comboId: "cream__yellow", comboDisplay: "Cream × Yellow", priceUsd: 50 },
  ];
  const us = [
    { comboId: "axanthic__lillywhite", comboDisplay: "Axanthic × Lilly White", priceUsd: 400 },
    { comboId: "axanthic__lillywhite", comboDisplay: "Axanthic × Lilly White", priceUsd: 400 },
    { comboId: "axanthic__lillywhite", comboDisplay: "Axanthic × Lilly White", priceUsd: 400 },
  ];
  const rows = buildSourceArbRows(kr, us, 3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.combo, "Axanthic × Lilly White");
  assert.equal(rows[0]!.low.label, KR_LABEL);
  assert.equal(rows[0]!.low.price, 100);
  assert.equal(rows[0]!.high.price, 400);
});
