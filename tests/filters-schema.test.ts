// Canonical filter schema parse/serialise round-trip.
//
// Goal: every URL we emit should re-parse to the same struct (modulo
// default elision), and stale / malformed values should fall back to
// defaults without throwing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  parseFilters,
  serialiseFilters,
  slugifyTrait,
  unslugTrait,
  toMarketFilters,
  withMarketFilters,
} from "../src/lib/filters/schema";

describe("parseFilters", () => {
  it("returns defaults for empty input", () => {
    const f = parseFilters(new URLSearchParams(""));
    assert.equal(f.tf, DEFAULTS.tf);
    assert.equal(f.region, DEFAULTS.region);
    assert.equal(f.combos.length, 0);
    assert.equal(f.priceMin, null);
    assert.equal(f.sources, "all");
  });

  it("parses every canonical key", () => {
    const f = parseFilters(
      new URLSearchParams(
        "tf=90d&region=US&age=adult&lineage=project&sex=female" +
          "&combos=lw-cap,axa-pin&traits=lilly-white,cappuccino" +
          "&sellers=s1,s2&priceMin=200&priceMax=900" +
          "&from=2026-01-01&to=2026-04-30" +
          "&sources=morphmarket,gi_listings&sort=median_desc",
      ),
    );
    assert.equal(f.tf, "90d");
    assert.equal(f.region, "US");
    assert.equal(f.age, "adult");
    assert.equal(f.lineage, "project");
    assert.equal(f.sex, "female");
    assert.deepEqual(f.combos, ["lw-cap", "axa-pin"]);
    assert.deepEqual(f.traits, ["lilly-white", "cappuccino"]);
    assert.deepEqual(f.sellers, ["s1", "s2"]);
    assert.equal(f.priceMin, 200);
    assert.equal(f.priceMax, 900);
    assert.equal(f.from, "2026-01-01");
    assert.equal(f.to, "2026-04-30");
    assert.equal(f.sort, "median_desc");
    assert.notEqual(f.sources, "all");
    if (f.sources !== "all") {
      assert.ok(f.sources.has("morphmarket"));
      assert.ok(f.sources.has("gi_listings"));
    }
  });

  it("falls back to defaults on unknown enum values", () => {
    const f = parseFilters(
      new URLSearchParams("tf=bogus&region=ZZ&age=infant&lineage=mystery"),
    );
    assert.equal(f.tf, DEFAULTS.tf);
    assert.equal(f.region, DEFAULTS.region);
    assert.equal(f.age, DEFAULTS.age);
    assert.equal(f.lineage, DEFAULTS.lineage);
  });

  it("accepts a plain object reader", () => {
    const f = parseFilters({ tf: "30d", combos: "lw-cap" });
    assert.equal(f.tf, "30d");
    assert.deepEqual(f.combos, ["lw-cap"]);
  });
});

describe("serialiseFilters", () => {
  it("emits an empty query string for defaults", () => {
    const out = serialiseFilters(DEFAULTS);
    assert.equal(out.toString(), "");
  });

  it("round-trips a non-default filter set", () => {
    const before = parseFilters(
      new URLSearchParams(
        "tf=30d&region=EU&combos=lw-cap,axa-pin&priceMin=100&priceMax=500",
      ),
    );
    const out = serialiseFilters(before);
    const after = parseFilters(out);
    assert.deepEqual(before.combos, after.combos);
    assert.equal(before.tf, after.tf);
    assert.equal(before.priceMin, after.priceMin);
    assert.equal(before.priceMax, after.priceMax);
  });

  it("preserves unknown keys when given current params", () => {
    const current = new URLSearchParams("page=3&tf=90d");
    const out = serialiseFilters({ tf: "30d" }, current);
    assert.equal(out.get("page"), "3");
    assert.equal(out.get("tf"), "30d");
  });

  it("collapses 'all sources selected' to no key", () => {
    const out = serialiseFilters({ sources: "all" });
    assert.equal(out.has("sources"), false);
  });
});

describe("slug helpers", () => {
  it("slugify is deterministic and reversible-enough", () => {
    assert.equal(slugifyTrait("Lilly White"), "lilly-white");
    assert.equal(slugifyTrait("Full Pinstripe"), "full-pinstripe");
    assert.equal(slugifyTrait("Tiger"), "tiger");
    assert.equal(unslugTrait("lilly-white"), "Lilly White");
    assert.equal(unslugTrait("super-dalmatian"), "Super Dalmatian");
  });
});

describe("market bridge", () => {
  it("toMarketFilters extracts the legacy shape", () => {
    const f = parseFilters(new URLSearchParams("tf=90d&region=US"));
    const m = toMarketFilters(f);
    assert.equal(m.timeframe, "90d");
    assert.equal(m.region, "US");
  });

  it("withMarketFilters re-lifts MarketFilters into canonical", () => {
    const f = parseFilters(new URLSearchParams("combos=lw-cap"));
    const merged = withMarketFilters(f, {
      timeframe: "30d",
      region: "EU",
      age: "adult",
      lineage: "any",
      sources: "all",
    });
    assert.equal(merged.tf, "30d");
    assert.equal(merged.region, "EU");
    assert.deepEqual(merged.combos, ["lw-cap"]);
  });
});
