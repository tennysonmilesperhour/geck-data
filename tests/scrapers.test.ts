import assert from "node:assert/strict";
import test from "node:test";
import { LISTINGS_SCRAPER } from "../src/lib/status/scrapers";

test("listings scraper copy is the API catalog plus weekly pulse, not hourly Decodo", () => {
  assert.match(LISTINGS_SCRAPER.label, /API catalog/i);
  assert.match(LISTINGS_SCRAPER.cadence, /weekday catalog/i);
  assert.match(LISTINGS_SCRAPER.cadence, /weekly 7-day/i);
  assert.doesNotMatch(LISTINGS_SCRAPER.label, /grid walk/i);
  assert.doesNotMatch(LISTINGS_SCRAPER.cadence, /hourly/i);
  assert.ok(LISTINGS_SCRAPER.thresholdHours >= 72);
});
