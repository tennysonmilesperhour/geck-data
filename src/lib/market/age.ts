// Age class inference from listing fields.
//
// Previously /data/market.json hardcoded `age_class: "subadult"` for every
// transaction (the function was called with `null` literally). This module
// extracts a meaningful age class from the maturity string the extension
// captures, falling back to weight + hatch-date heuristics when maturity
// is missing.
//
// Output set matches geck-inspect's market analytics filter vocabulary:
//   hatchling | juvenile | subadult | adult | proven_breeder

export type AgeClass =
  | "hatchling"
  | "juvenile"
  | "subadult"
  | "adult"
  | "proven_breeder"
  | "unknown";

const MATURITY_RULES: Array<{ test: RegExp; cls: AgeClass }> = [
  { test: /\b(proven\s*breed|proven\s*female|proven\s*male)/i, cls: "proven_breeder" },
  { test: /\b(adult)\b/i,                                       cls: "adult" },
  { test: /\b(sub[\s-]?adult)\b/i,                              cls: "subadult" },
  { test: /\b(juven|yearling)/i,                                cls: "juvenile" },
  { test: /\b(hatch|baby|neonate)/i,                            cls: "hatchling" },
];

/**
 * Classify by the maturity field first. If that's missing or unparseable,
 * fall back to weight (grams) using crested-gecko growth norms, then to
 * hatch_date if present. Returns "unknown" only when nothing is available.
 */
export function classifyAge(opts: {
  maturity?: string | null;
  weight?: number | string | null;
  hatch_date?: string | null;
  is_breeding?: boolean | null;
}): AgeClass {
  if (opts.is_breeding === true) return "proven_breeder";

  if (typeof opts.maturity === "string" && opts.maturity.length > 0) {
    for (const rule of MATURITY_RULES) {
      if (rule.test.test(opts.maturity)) return rule.cls;
    }
  }

  const weight = parseGrams(opts.weight);
  if (weight != null) {
    if (weight < 5) return "hatchling";
    if (weight < 18) return "juvenile";
    if (weight < 35) return "subadult";
    return "adult";
  }

  if (typeof opts.hatch_date === "string" && opts.hatch_date.length > 0) {
    const t = Date.parse(opts.hatch_date);
    if (!Number.isNaN(t)) {
      const monthsOld = (Date.now() - t) / (30.44 * 24 * 3600 * 1000);
      if (monthsOld < 3) return "hatchling";
      if (monthsOld < 9) return "juvenile";
      if (monthsOld < 18) return "subadult";
      return "adult";
    }
  }

  return "unknown";
}

function parseGrams(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const m = v.match(/([\d.]+)\s*(g|gram|grams|gr)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}
