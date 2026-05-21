import { test } from "node:test";
import assert from "node:assert/strict";
import { listingMatchesAlert } from "../src/lib/alerts/matcher";

const baseListing = {
  id: "mm_1",
  cached_traits: "Lilly White | Axanthic | Pinstripe",
  norm_traits: "lilly white axanthic pinstripe",
  species: "crested",
  price_usd: 350,
  seller_id: "s_42",
  seller_location: "Atlanta, GA, USA",
};

test("listingMatchesAlert empty query matches everything", () => {
  const v = listingMatchesAlert({}, { trigger: "listingSeen", listing: baseListing });
  assert.equal(v.ok, true);
});

test("listingMatchesAlert trait_all requires every token", () => {
  assert.equal(
    listingMatchesAlert(
      { trait_all: ["lilly white", "axanthic"] },
      { trigger: "listingSeen", listing: baseListing },
    ).ok,
    true,
  );
  assert.equal(
    listingMatchesAlert(
      { trait_all: ["lilly white", "moonglow"] },
      { trigger: "listingSeen", listing: baseListing },
    ).ok,
    false,
  );
});

test("listingMatchesAlert trait_any requires at least one", () => {
  assert.equal(
    listingMatchesAlert(
      { trait_any: ["moonglow", "axanthic"] },
      { trigger: "listingSeen", listing: baseListing },
    ).ok,
    true,
  );
  assert.equal(
    listingMatchesAlert(
      { trait_any: ["moonglow", "sable"] },
      { trigger: "listingSeen", listing: baseListing },
    ).ok,
    false,
  );
});

test("listingMatchesAlert respects min/max price", () => {
  assert.equal(
    listingMatchesAlert(
      { min_price: 100, max_price: 500 },
      { trigger: "listingSeen", listing: baseListing },
    ).ok,
    true,
  );
  assert.equal(
    listingMatchesAlert(
      { min_price: 400 },
      { trigger: "listingSeen", listing: baseListing },
    ).ok,
    false,
  );
});

test("listingMatchesAlert must_be_drop gates listingSeen", () => {
  assert.equal(
    listingMatchesAlert(
      { must_be_drop: true },
      { trigger: "listingSeen", listing: baseListing },
    ).ok,
    false,
  );
  assert.equal(
    listingMatchesAlert(
      { must_be_drop: true },
      { trigger: "priceDrop", listing: baseListing },
    ).ok,
    true,
  );
});

test("listingMatchesAlert regions filter", () => {
  assert.equal(
    listingMatchesAlert(
      { regions: ["US"] },
      { trigger: "listingSeen", listing: baseListing },
    ).ok,
    true,
  );
  assert.equal(
    listingMatchesAlert(
      { regions: ["UK", "EU"] },
      { trigger: "listingSeen", listing: baseListing },
    ).ok,
    false,
  );
});
