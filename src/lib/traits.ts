// Shared trait-string tokenizer for market_listings.cached_traits and
// market_listings.norm_traits.
//
// Why this exists: the Chrome extension concatenates every additionalProperty
// on a MorphMarket listing into cached_traits, including non-trait fields
// like "Diet: Meal Replacement" and "Proven breeder: No". The result looks
// like one of:
//
//   "Diet: Meal Replacement | Proven breeder: No | Pinstripe, Crowned, Orange"
//   "diet: meal replacement proven breeder: no pinstripe, crowned, orange"
//
// The pre-2026-05-15 read-time tokenizers split on "," or whitespace and
// surfaced "diet: meal replacement extreme harlequin" as a trait on /trends.
//
// The fix: any token that still contains ":" after splitting is a leaked
// key/value segment, not a real trait. Drop those.

const KEY_PREFIXES = [
  "diet",
  "proven breeder",
  "sex",
  "maturity",
  "weight",
  "birth date",
  "birthdate",
  "hatched",
  "origin",
  "pet only",
  "lineage",
  "shipping",
  "payment",
  "scientific name",
  "category",
] as const;

// Matches a segment that either starts with "<known key>:" or that IS
// the bare property name on its own (e.g., "Proven breeder" with no
// value attached, which the extension sometimes emits). The trailing
// "|" handles the case where pipe-splitting leaves a residual delimiter
// in the segment (defensive — shouldn't happen after split, but cheap).
const KEY_PREFIX_RE = new RegExp(
  `^\\s*(?:${KEY_PREFIXES.join("|")})\\s*(?::|$|\\|)`,
  "i",
);

export type TraitRow = {
  norm_traits?: string | null;
  cached_traits?: string | null;
};

/** Pick the most structured of the two columns. cached_traits keeps its
 * pipe delimiters and original casing; norm_traits is lowercased with
 * pipes flattened to spaces, which loses structure. Prefer cached when
 * present. */
function pickSource(r: TraitRow): string {
  const cached = (r.cached_traits ?? "").trim();
  if (cached) return cached;
  return (r.norm_traits ?? "").trim();
}

/** Tokenize a trait string into lowercase trait tokens. Drops any segment
 * that contains ":" (a leaked key/value pair) and any token shorter than 3
 * chars. Dedupes while preserving order. */
export function parseTraitList(input: string | TraitRow): string[] {
  const raw =
    typeof input === "string" ? input : pickSource(input);
  if (!raw) return [];

  // Step 1: split on pipes if present. The cached_traits column uses
  // " | " between top-level properties. Drop any segment that starts
  // with a known key prefix ("Diet:", "Proven breeder:", ...). Also
  // apply this filter when there is no pipe — a single-segment
  // "Diet: Meal Replacement" row would otherwise leak its words as
  // fake traits via the step-2 whitespace fallback.
  const segments = raw
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s && !KEY_PREFIX_RE.test(s));

  // Step 2: split each remaining segment on commas, then fall back to
  // whitespace only when no comma is present (matches the historical
  // tokenizer behaviour for legacy rows that ship just one trait).
  const tokens: string[] = [];
  for (const seg of segments) {
    const parts = seg.includes(",")
      ? seg.split(",")
      : seg.split(/\s+/);
    for (const p of parts) {
      tokens.push(p.trim());
    }
  }

  // Step 3: drop tokens that still carry a colon. This is the catch-all
  // that handles the norm_traits case where pipes were already flattened
  // and only commas separate segments. The leaked "diet: meal replacement
  // ..." block lands here as a single token and gets filtered out.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!t || t.length < 3) continue;
    if (t.includes(":")) continue;
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}

/** Sanitize a raw cached_traits string for *write*. Strips the "Diet: ...|"
 * and "Proven breeder: ...|" style key/value prefix segments so the value
 * landing in the DB only contains real trait segments. Keeps the pipe
 * structure for whatever survives so downstream consumers can still split
 * cleanly. Returns null when the input collapses to an empty string. */
export function sanitizeCachedTraits(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const segments = trimmed.includes("|") ? trimmed.split("|") : [trimmed];
  const kept = segments
    .map((s) => s.trim())
    .filter((s) => s && !KEY_PREFIX_RE.test(s));
  if (kept.length === 0) return null;
  return kept.join(" | ");
}

/** Sanitize a raw norm_traits string for write. Same idea as
 * sanitizeCachedTraits but the source is already lowercased with pipes
 * replaced by spaces, so we operate on the comma-separated form. */
export function sanitizeNormTraits(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Drop any comma-segment that contains a colon — that's the only signal
  // we have post-flattening.
  const kept = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.includes(":"));
  if (kept.length === 0) return null;
  return kept.join(", ");
}
