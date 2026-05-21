// Canonical high-value combo definitions, single source of truth.
//
// Previously duplicated between src/app/data/market.json/route.ts
// (HIGH_VALUE_COMBOS) and src/lib/market/widget-types.ts (COMBOS).
// Both consumers now import from here; the two lists used to drift.
//
// Must stay in lockstep with geck-inspect's
// src/lib/marketAnalytics/taxonomy.js. Trait order in `traits` is
// irrelevant; the matcher does set-based comparison.

export type CanonicalCombo = {
  /** Stable short id used in URLs and JSON payloads. */
  id: string;
  /** Display name with " x " separator, ASCII for JSON. */
  name: string;
  /** Display name with " × " separator, for UI surfaces. */
  display: string;
  /** Trait tokens that all must be present (case/punctuation-insensitive). */
  traits: string[];
};

export const HIGH_VALUE_COMBOS: CanonicalCombo[] = [
  { id: "lw-axa",       name: "Lilly White x Axanthic",        display: "Lilly White × Axanthic",        traits: ["Lilly White", "Axanthic"] },
  { id: "lw-cap",       name: "Lilly White x Cappuccino",      display: "Lilly White × Cappuccino",      traits: ["Lilly White", "Cappuccino"] },
  { id: "cap-pin",      name: "Cappuccino x Full Pinstripe",   display: "Cappuccino × Full Pinstripe",   traits: ["Cappuccino", "Full Pinstripe"] },
  { id: "axa-pin",      name: "Axanthic x Full Pinstripe",     display: "Axanthic × Full Pinstripe",     traits: ["Axanthic", "Full Pinstripe"] },
  { id: "sable-harl",   name: "Sable x Extreme Harlequin",     display: "Sable × Extreme Harlequin",     traits: ["Sable", "Extreme Harlequin"] },
  { id: "frap-pin",     name: "Frappuccino x Pinstripe",       display: "Frappuccino × Pinstripe",       traits: ["Frappuccino", "Pinstripe"] },
  { id: "moonglow-dal", name: "Moonglow x Super Dalmatian",    display: "Moonglow × Super Dalmatian",    traits: ["Moonglow", "Super Dalmatian"] },
  { id: "lw-soft",      name: "Lilly White x Soft Scale",      display: "Lilly White × Soft Scale",      traits: ["Lilly White", "Soft Scale"] },
  { id: "axa-harl",     name: "Axanthic x Extreme Harlequin",  display: "Axanthic × Extreme Harlequin",  traits: ["Axanthic", "Extreme Harlequin"] },
  { id: "cap-dal",      name: "Cappuccino x Super Dalmatian",  display: "Cappuccino × Super Dalmatian",  traits: ["Cappuccino", "Super Dalmatian"] },
  { id: "red-harl",     name: "Red Harlequin",                 display: "Red Harlequin",                 traits: ["Red", "Harlequin"] },
  { id: "tiger-pin",    name: "Tiger x Pinstripe",             display: "Tiger × Pinstripe",             traits: ["Tiger", "Pinstripe"] },
];

/** Display-form combo list for widgets that take the union of strings. */
export const COMBO_DISPLAYS = HIGH_VALUE_COMBOS.map((c) => c.display) as ReadonlyArray<string>;

export function normTrait(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function traitTokens(input: unknown): Set<string> {
  if (Array.isArray(input)) {
    return new Set(input.map((t) => normTrait(String(t))));
  }
  if (typeof input === "string") {
    return new Set(
      input.split(/[,;|/]+|\s+/).map((t) => normTrait(t)).filter(Boolean),
    );
  }
  return new Set();
}

export function matchCombo(traits: unknown): CanonicalCombo | null {
  const tokens = traitTokens(traits);
  if (tokens.size === 0) return null;
  for (const c of HIGH_VALUE_COMBOS) {
    const need = c.traits.map(normTrait);
    if (need.every((n) => tokens.has(n))) return c;
  }
  return null;
}
