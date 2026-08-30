import assert from "node:assert/strict";
import test from "node:test";
import { LISTINGS_SCRAPER, FEEDLE_SCRAPER, SHOPS_SCRAPER } from "../src/lib/status/scrapers";

test("listings scraper copy is the API catalog plus weekly pulse, not hourly Decodo", () => {
  assert.match(LISTINGS_SCRAPER.label, /API catalog/i);
  assert.match(LISTINGS_SCRAPER.cadence, /weekday catalog/i);
  assert.match(LISTINGS_SCRAPER.cadence, /weekly 7-day/i);
  assert.doesNotMatch(LISTINGS_SCRAPER.label, /grid walk/i);
  assert.doesNotMatch(LISTINGS_SCRAPER.cadence, /hourly/i);
  assert.ok(LISTINGS_SCRAPER.thresholdHours >= 72);
});

test("cross-platform scrapers are weekday Denver jobs, not MorphMarket listings", () => {
  assert.equal(FEEDLE_SCRAPER.scrapeType, "cross_platform_feedle");
  assert.equal(SHOPS_SCRAPER.scrapeType, "cross_platform_shops");
  assert.match(FEEDLE_SCRAPER.cadence, /weekday/i);
  assert.match(SHOPS_SCRAPER.cadence, /weekday/i);
  assert.doesNotMatch(FEEDLE_SCRAPER.scrapeType, /listings/);
});
