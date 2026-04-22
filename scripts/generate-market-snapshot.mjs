#!/usr/bin/env node
/**
 * Generate public/data/market.json — the market-intelligence snapshot that
 * powers geck-inspect's in-app Business Tools Market Analytics module.
 *
 * The schema matches the docstring in geck-inspect's
 * src/lib/marketAnalytics/queries.js exactly:
 *
 *   {
 *     version: 1,
 *     generated_at: "ISO-8601",
 *     transactions:    [...],
 *     breeders:        [...],
 *     supply_pipeline: [...],
 *     demand_signals:  { <morph>: {...} },
 *     market_events:   [...]
 *   }
 *
 * The generator is deterministic — seeded mulberry32 RNGs mean the output
 * is byte-stable across runs so diffs stay meaningful. The fixture logic
 * mirrors geck-inspect's src/lib/marketAnalytics/mockFixtures.js so today's
 * snapshot is the same shape the app already falls back to. When real
 * pipelines are wired, replace the body of each build* function with a
 * Supabase query aggregating the same axes.
 *
 *   usage: node scripts/generate-market-snapshot.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "..", "public", "data", "market.json");

// ---------- Taxonomy (mirrors geck-inspect's taxonomy.js) -------------
const CANONICAL_MORPHS = [
  { name: "Lilly White",       premium_tier: "flagship" },
  { name: "Axanthic",          premium_tier: "flagship" },
  { name: "Cappuccino",        premium_tier: "flagship" },
  { name: "Sable",             premium_tier: "premium" },
  { name: "Frappuccino",       premium_tier: "premium" },
  { name: "Moonglow",          premium_tier: "premium" },
  { name: "Full Pinstripe",    premium_tier: "premium" },
  { name: "Pinstripe",         premium_tier: "mid" },
  { name: "Phantom Pinstripe", premium_tier: "premium" },
  { name: "Empty Back",        premium_tier: "mid" },
  { name: "Soft Scale",        premium_tier: "flagship" },
  { name: "Harlequin",         premium_tier: "mid" },
  { name: "Extreme Harlequin", premium_tier: "premium" },
  { name: "Tiger",             premium_tier: "mid" },
  { name: "Brindle",           premium_tier: "mid" },
  { name: "Dalmatian",         premium_tier: "mid" },
  { name: "Super Dalmatian",   premium_tier: "premium" },
  { name: "Flame",             premium_tier: "entry" },
  { name: "Bicolor",           premium_tier: "entry" },
  { name: "Patternless",       premium_tier: "entry" },
  { name: "Red",               premium_tier: "mid" },
  { name: "Yellow",             premium_tier: "entry" },
  { name: "Cream",             premium_tier: "entry" },
  { name: "Orange",            premium_tier: "mid" },
];

const HIGH_VALUE_COMBOS = [
  { id: "lw-axa",       name: "Lilly White × Axanthic",       traits: ["Lilly White", "Axanthic"] },
  { id: "lw-cap",       name: "Lilly White × Cappuccino",     traits: ["Lilly White", "Cappuccino"] },
  { id: "cap-pin",      name: "Cappuccino × Full Pinstripe",  traits: ["Cappuccino", "Full Pinstripe"] },
  { id: "axa-pin",      name: "Axanthic × Full Pinstripe",    traits: ["Axanthic", "Full Pinstripe"] },
  { id: "sable-harl",   name: "Sable × Extreme Harlequin",    traits: ["Sable", "Extreme Harlequin"] },
  { id: "frap-pin",     name: "Frappuccino × Pinstripe",      traits: ["Frappuccino", "Pinstripe"] },
  { id: "moonglow-dal", name: "Moonglow × Super Dalmatian",   traits: ["Moonglow", "Super Dalmatian"] },
  { id: "lw-soft",      name: "Lilly White × Soft Scale",     traits: ["Lilly White", "Soft Scale"] },
  { id: "axa-harl",     name: "Axanthic × Extreme Harlequin", traits: ["Axanthic", "Extreme Harlequin"] },
  { id: "cap-dal",      name: "Cappuccino × Super Dalmatian", traits: ["Cappuccino", "Super Dalmatian"] },
  { id: "red-harl",     name: "Red Harlequin",                traits: ["Red", "Harlequin"] },
  { id: "tiger-pin",    name: "Tiger × Pinstripe",            traits: ["Tiger", "Pinstripe"] },
];

const REGIONS = [
  { code: "US",  name: "United States",    currency: "USD", import_friction: 0.10 },
  { code: "EU",  name: "European Union",   currency: "EUR", import_friction: 0.60 },
  { code: "UK",  name: "United Kingdom",   currency: "GBP", import_friction: 0.70 },
  { code: "CA",  name: "Canada",           currency: "CAD", import_friction: 0.40 },
  { code: "AU",  name: "Australia",        currency: "AUD", import_friction: 0.95 },
  { code: "JP",  name: "Japan",            currency: "JPY", import_friction: 0.80 },
  { code: "SE",  name: "Sweden / Nordics", currency: "SEK", import_friction: 0.50 },
  { code: "SEA", name: "Southeast Asia",   currency: "USD", import_friction: 0.85 },
];

const AGE_CLASSES = [
  { code: "baby",     price_multiplier: 1.0 },
  { code: "juvenile", price_multiplier: 1.25 },
  { code: "subadult", price_multiplier: 1.6 },
  { code: "adult",    price_multiplier: 2.0 },
  { code: "proven_m", price_multiplier: 2.6 },
  { code: "proven_f", price_multiplier: 3.4 },
];

const LINEAGE_TIERS = [
  { code: "unknown",        price_multiplier: 1.0 },
  { code: "hobby",          price_multiplier: 1.1 },
  { code: "regional_known", price_multiplier: 1.6 },
  { code: "named",          price_multiplier: 2.4 },
  { code: "og_line",        price_multiplier: 4.0 },
];

// ---------- Seeded RNG (mulberry32) -----------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const seeded = (key) => mulberry32(hashString(String(key)));

// ---------- Breeders --------------------------------------------------
const BREEDER_NAMES = [
  "Ridgeback Reptiles", "Moonlit Morphs", "Crested Cascades", "Alpine Geckos",
  "Tidewater Exotics", "Northern Lights Cresties", "Sable Coast Herps",
  "Obsidian Line Reptiles", "Frost & Flame", "Harbor City Geckos",
  "Terra Nova Cresties", "Kodama Reptiles", "Kobe Color Lab",
  "Nordic Morph Works", "Lowlands Reptile Collective", "Cordillera Geckos",
  "Pacific Rim Exotics", "Outback Cresties", "Midland Morphs",
  "Rainwood Reptiles", "Skyline Geckos", "Copperleaf Cresties",
  "Silverstream Exotics", "High Desert Herps", "Channel Island Geckos",
];

function pickSpecialties(rng) {
  const pool = CANONICAL_MORPHS.map((m) => m.name);
  const count = 1 + Math.floor(rng() * 3);
  const out = new Set();
  while (out.size < count) out.add(pool[Math.floor(rng() * pool.length)]);
  return [...out];
}

function buildBreeders() {
  return BREEDER_NAMES.map((name, i) => {
    const rng = seeded(`breeder:${name}`);
    const tierRoll = rng();
    const tier =
      tierRoll < 0.05 ? "og_line" :
      tierRoll < 0.25 ? "named" :
      tierRoll < 0.60 ? "regional_known" :
      "hobby";
    const regionPool = ["US","US","US","EU","EU","UK","CA","AU","JP","SE"];
    const region = regionPool[Math.floor(rng() * regionPool.length)];
    return {
      id: `b_${String(i).padStart(3, "0")}`,
      name,
      tier,
      region,
      active_since: 2005 + Math.floor(rng() * 18),
      specialties: pickSpecialties(rng),
    };
  });
}

// ---------- Transactions ---------------------------------------------
function morphBasePrice(morphName) {
  const m = CANONICAL_MORPHS.find((x) => x.name === morphName);
  const anchor =
    m?.premium_tier === "flagship" ? 800 :
    m?.premium_tier === "premium"  ? 450 :
    m?.premium_tier === "mid"      ? 200 :
    100;
  const rng = seeded(`anchor:${morphName}`);
  return Math.round(anchor * (0.85 + rng() * 0.3));
}

function regionMultiplier(region, morphName) {
  const rng = seeded(`regbias:${region}:${morphName}`);
  const noise = 0.9 + rng() * 0.2;
  const m = morphName;
  const byRegion = {
    US:  1.0,
    EU:  m.includes("Lilly") ? 1.25 : m.includes("Axanthic") ? 1.15 : 1.0,
    UK:  m.includes("Lilly") ? 1.2 : 0.95,
    CA:  0.9,
    AU:  1.6,
    JP:  (m === "Moonglow" || m === "Sable" || m.includes("Soft Scale")) ? 1.5 : 1.1,
    SE:  m === "Axanthic" ? 1.3 : 1.0,
    SEA: 0.7,
  };
  return (byRegion[region] ?? 1.0) * noise;
}

const ageMult = (c) => AGE_CLASSES.find((a) => a.code === c)?.price_multiplier ?? 1;
const lineageMult = (c) => LINEAGE_TIERS.find((t) => t.code === c)?.price_multiplier ?? 1;

const TX_POOL_SIZE = 600;

function buildTransactions(breeders) {
  const rng = seeded("transactions:v2");
  const out = [];
  const now = Date.now();
  const dayMs = 86_400_000;
  for (let i = 0; i < TX_POOL_SIZE; i++) {
    const combo = HIGH_VALUE_COMBOS[Math.floor(rng() * HIGH_VALUE_COMBOS.length)];
    const primaryMorph = combo.traits[0];
    const region = REGIONS[Math.floor(rng() * REGIONS.length)].code;
    const age = AGE_CLASSES[Math.floor(rng() * AGE_CLASSES.length)].code;
    const lineage = LINEAGE_TIERS[Math.floor(rng() * LINEAGE_TIERS.length)].code;
    const breeder = breeders[Math.floor(rng() * breeders.length)];
    const daysAgo = Math.floor(rng() * 540);
    const status = rng() < 0.55 ? "sold" : "listed";
    const basePrice = morphBasePrice(primaryMorph)
      * regionMultiplier(region, primaryMorph)
      * ageMult(age)
      * lineageMult(lineage);
    const comboPremium = 1 + (combo.traits.length - 1) * (0.15 + rng() * 0.2);
    const askPrice = basePrice * comboPremium * (0.9 + rng() * 0.25);
    const soldSpread = 0.82 + rng() * 0.14;
    const soldPrice = askPrice * soldSpread;
    const sourceRoll = rng();
    const source_id =
      sourceRoll < 0.35 ? "internal.sales" :
      sourceRoll < 0.55 ? "internal.listings" :
      sourceRoll < 0.78 ? "external.morphmarket" :
      sourceRoll < 0.88 ? "external.breeder_sites" :
      sourceRoll < 0.94 ? "external.pangea" :
      sourceRoll < 0.98 ? "external.eu_classifieds" :
      "external.fb";
    const time_on_market = status === "sold"
      ? Math.round(3 + rng() * 60)
      : Math.round(1 + rng() * 90);
    out.push({
      id: `tx_${String(i).padStart(4, "0")}`,
      combo_id: combo.id,
      combo_name: combo.name,
      traits: combo.traits,
      primary_morph: primaryMorph,
      region,
      age_class: age,
      lineage_tier: lineage,
      breeder_id: breeder.id,
      breeder_name: breeder.name,
      status,
      ask_price: Math.round(askPrice),
      sold_price: status === "sold" ? Math.round(soldPrice) : null,
      time_on_market_days: time_on_market,
      date: new Date(now - daysAgo * dayMs).toISOString().slice(0, 10),
      source_id,
    });
  }
  return out;
}

// ---------- Supply pipeline ------------------------------------------
function buildSupplyPipeline() {
  const rng = seeded("supply:v2");
  const now = new Date();
  const months = [];
  for (let m = 0; m < 9; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    months.push({
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleString("en", { month: "short", year: "2-digit" }),
    });
  }
  return HIGH_VALUE_COMBOS.map((combo) => {
    const baseHatchlings = 4 + Math.floor(rng() * 16);
    const series = months.map((mo, idx) => {
      const seasonal = [0.4, 0.6, 1.2, 1.6, 1.8, 1.4, 1.0, 0.7, 0.4][idx];
      const projected = Math.round(baseHatchlings * seasonal * (0.7 + rng() * 0.6));
      return { month: mo.key, label: mo.label, projected_hatchlings: projected };
    });
    return {
      combo_id: combo.id,
      combo_name: combo.name,
      traits: combo.traits,
      active_pairs: 1 + Math.floor(rng() * 12),
      source_id: "internal.breeding",
      series,
    };
  });
}

// ---------- Demand signals -------------------------------------------
function buildDemandSignals() {
  const out = {};
  CANONICAL_MORPHS.forEach((m) => {
    const rng = seeded(`demand:${m.name}`);
    const base = 30 + Math.floor(rng() * 200);
    const weeks = [];
    let cur = base;
    for (let w = 25; w >= 0; w--) {
      const drift = (rng() - 0.45) * 12;
      cur = Math.max(5, cur + drift);
      weeks.push({
        week: w,
        searches: Math.round(cur),
        watchlist_adds: Math.round(cur * (0.05 + rng() * 0.15)),
      });
    }
    out[m.name] = {
      morph: m.name,
      weekly: weeks.reverse(),
      source_id: "internal.behavior",
    };
  });
  return out;
}

// ---------- Market events --------------------------------------------
function buildMarketEvents() {
  const now = new Date();
  const events = [
    { id: "e1", name: "Tinley Park Herpetoculture", region: "US", days_from_now: -8,  impact: "high",   kind: "expo",    source_id: "external.expos" },
    { id: "e2", name: "Houston Reptile Expo",        region: "US", days_from_now: 14,  impact: "medium", kind: "expo",    source_id: "external.expos" },
    { id: "e3", name: "Hamm Terraristika",           region: "EU", days_from_now: 42,  impact: "high",   kind: "expo",    source_id: "external.expos" },
    { id: "e4", name: "Ridgeback Q2 release drop",   region: "US", days_from_now: 21,  impact: "medium", kind: "release", source_id: "external.breeder_sites" },
    { id: "e5", name: "Kodama Reptiles summer drop", region: "JP", days_from_now: 60,  impact: "high",   kind: "release", source_id: "external.breeder_sites" },
    { id: "e6", name: "Nordic Morph Works release",  region: "SE", days_from_now: 80,  impact: "medium", kind: "release", source_id: "external.breeder_sites" },
    { id: "e7", name: "Doncaster IHS show",          region: "UK", days_from_now: 95,  impact: "medium", kind: "expo",    source_id: "external.expos" },
  ];
  return events.map((e) => ({
    ...e,
    date: new Date(now.getTime() + e.days_from_now * 86_400_000).toISOString().slice(0, 10),
  }));
}

// ---------- Assemble + write -----------------------------------------
function build() {
  const breeders = buildBreeders();
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    transactions: buildTransactions(breeders),
    breeders,
    supply_pipeline: buildSupplyPipeline(),
    demand_signals: buildDemandSignals(),
    market_events: buildMarketEvents(),
  };
}

const snapshot = build();
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(snapshot, null, 2) + "\n");

const kb = (JSON.stringify(snapshot).length / 1024).toFixed(1);
console.log(
  `wrote ${OUTPUT} — ${snapshot.transactions.length} tx, ` +
  `${snapshot.breeders.length} breeders, ` +
  `${snapshot.supply_pipeline.length} pipelines, ` +
  `${Object.keys(snapshot.demand_signals).length} morphs, ` +
  `${snapshot.market_events.length} events (${kb} KB)`,
);
