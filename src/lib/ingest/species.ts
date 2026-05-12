// Species detection from MorphMarket payloads.
//
// Geck Inspect is crested-gecko-first. The extension scrapes whatever
// MorphMarket page the user views, so non-crested listings (leopards,
// gargoyles, leachies, etc.) arrive in the same ingest stream as cresteds.
// This module turns the species hints MorphMarket provides into a canonical
// short label we can store and filter on.
//
// We intentionally use coarse-grained labels (crested / leopard / gargoyle /
// leachie / chahoua / african_fat_tail / other_reptile / unknown) rather
// than scientific names so SQL filters stay readable. Add new labels here
// when a new MorphMarket category shows up; default to 'other_reptile' for
// anything unrecognized that's clearly not a gecko of interest, and
// 'unknown' when we can't tell at all.

export type Species =
  | "crested"
  | "leopard"
  | "gargoyle"
  | "leachie"
  | "chahoua"
  | "african_fat_tail"
  | "other_reptile"
  | "unknown";

const URL_MAP: Array<[RegExp, Species]> = [
  [/\/crested-geckos?\//i, "crested"],
  [/\/leopard-geckos?\//i, "leopard"],
  [/\/gargoyle-geckos?\//i, "gargoyle"],
  [/\/leachi(?:e|anus)\//i, "leachie"],
  [/\/(?:rough-?snouted-)?chahoua/i, "chahoua"],
  [/\/(?:african-)?fat-tail/i, "african_fat_tail"],
];

// Trait/title heuristics for payloads where the URL is missing or
// non-standard (cross-platform listings, partial events, etc.). Conservative:
// we only fire on tight, species-specific keywords.
const TEXT_MAP: Array<[RegExp, Species]> = [
  [/crested gecko|correlophus ciliatus/i, "crested"],
  [/leopard gecko|eublepharis macularius/i, "leopard"],
  [/gargoyle gecko|rhacodactylus auriculatus/i, "gargoyle"],
  [/leachianus|mniarogekko/i, "leachie"],
  [/chahoua|mossy prehensile/i, "chahoua"],
  [/african fat[- ]?tail|hemitheconyx/i, "african_fat_tail"],
];

function fromUrl(url: string | null | undefined): Species | null {
  if (!url) return null;
  for (const [re, label] of URL_MAP) if (re.test(url)) return label;
  return null;
}

function fromText(text: string | null | undefined): Species | null {
  if (!text) return null;
  for (const [re, label] of TEXT_MAP) if (re.test(text)) return label;
  return null;
}

/**
 * Best-effort species classification of a MorphMarket animal payload.
 * Falls back to 'unknown' so the column always gets a value (preferable to
 * NULL because filters on the read side stay simple: `species = 'crested'`).
 */
export function speciesFromAnimal(data: Record<string, unknown> | null | undefined): Species {
  if (!data) return "unknown";

  // 1. URL/slug path. The path field on MorphMarket animal payloads looks
  //    like '/c/reptiles/lizards/crested-geckos/ABC/...', which is the most
  //    reliable signal.
  const path = typeof data.path === "string" ? data.path : null;
  const share = typeof data.share_url === "string" ? data.share_url : null;
  const byPath = fromUrl(path) ?? fromUrl(share);
  if (byPath) return byPath;

  // 2. Category breadcrumb. Some payloads expose category objects with a
  //    slug or name; cheap to spot-check.
  const cats = data.categories;
  if (Array.isArray(cats)) {
    for (const c of cats) {
      if (!c || typeof c !== "object") continue;
      const cr = c as Record<string, unknown>;
      const blob = [cr.slug, cr.name, cr.path].filter((v) => typeof v === "string").join(" ");
      const hit = fromUrl(blob) ?? fromText(blob);
      if (hit) return hit;
    }
  }

  // 3. Title / clean_title text. Less reliable but catches cross-platform
  //    listings and edge cases.
  const title = typeof data.clean_title === "string"
    ? data.clean_title
    : typeof data.title === "string"
      ? data.title
      : null;
  const byTitle = fromText(title);
  if (byTitle) return byTitle;

  return "unknown";
}

/**
 * Same logic for cross-platform listings (FaunaClassifieds, Preloved, etc.).
 * URL field naming differs across platforms; we accept a generic shape.
 */
export function speciesFromCrossPlatform(data: Record<string, unknown>): Species {
  const url = typeof data.url === "string" ? data.url : null;
  const title = typeof data.title === "string" ? data.title : null;
  const description = typeof data.description === "string" ? data.description : null;
  return (
    fromUrl(url) ??
    fromText(title) ??
    fromText(description) ??
    "unknown"
  );
}

/**
 * Returns true if the species label is anything we'd treat as crested for
 * the public listing-images bucket and Geck Inspect analytics. Everything
 * else (including 'unknown') routes to the archive bucket so we never
 * accidentally surface a leopard as crested.
 */
export function isCrested(species: string | null | undefined): boolean {
  return species === "crested";
}

export const CRESTED: Species = "crested";
