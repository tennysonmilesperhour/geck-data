import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSellerLocation,
  summarizeSellerLocations,
} from "../src/lib/sellers/location";

test("city and state locations resolve to the US state grain", () => {
  assert.deepEqual(parseSellerLocation("Miami, FL"), {
    countryCode: "US",
    country: "United States",
    usState: "Florida",
  });
  assert.equal(parseSellerLocation("Atlanta, GA, USA").usState, "Georgia");
});

test("exact two-letter feed values remain country codes", () => {
  assert.deepEqual(parseSellerLocation("CA"), {
    countryCode: "CA",
    country: "Canada",
    usState: null,
  });
  assert.equal(parseSellerLocation("DE").country, "Germany");
  assert.equal(parseSellerLocation("GB").country, "United Kingdom");
});

test("known Canadian cities using the CA country suffix are not mapped to California", () => {
  assert.deepEqual(parseSellerLocation("Coquitlam, CA"), {
    countryCode: "CA",
    country: "Canada",
    usState: null,
  });
  assert.equal(parseSellerLocation("Ontario, CA").usState, "California");
});

test("Canadian province codes do not enter the US state distribution", () => {
  assert.deepEqual(parseSellerLocation("Toronto, ON"), {
    countryCode: "CA",
    country: "Canada",
    usState: null,
  });
});

test("summaries count each seller once per applicable geographic level", () => {
  const summary = summarizeSellerLocations([
    { seller_location: "US" },
    { seller_location: "Austin, TX" },
    { seller_location: "Toronto, ON" },
    { seller_location: "CA" },
    { seller_location: "GB" },
    { seller_location: null },
    { seller_location: "somewhere" },
  ]);

  assert.equal(summary.total, 7);
  assert.equal(summary.missing, 1);
  assert.equal(summary.unclassified, 1);
  assert.equal(summary.countryKnown, 5);
  assert.deepEqual(summary.countries, [
    { label: "Canada", count: 2 },
    { label: "United States", count: 2 },
    { label: "United Kingdom", count: 1 },
  ]);
  assert.equal(summary.usSellerCount, 2);
  assert.equal(summary.usStateKnown, 1);
  assert.deepEqual(summary.usStates, [{ label: "Texas", count: 1 }]);
});
