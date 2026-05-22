// Anchor morph palette. Each major morph family gets a signature
// colour applied wherever it appears across the dashboard so the
// viewer can scan by hue instead of label. Picks lean field-guide
// (chosen to read against the dark forest surfaces) and align
// loosely with the visual identity of each morph in real life:
//
//   Lilly White: pale cream / parchment — the morph is bright,
//                near-white in real life.
//   Axanthic:    cool ocean blue — the axanthic gene strips reds and
//                yellows, leaving a silvery cast.
//   Harlequin:   warm clay / terracotta — the pattern tends to
//                contrast cream against orange-red.
//   Cappuccino:  rich coffee brown — explicit.
//
// Each entry includes a `hex` (stroke / line / accent), `soft`
// (background tint), `text` (foreground when used as label), and a
// hover-state `glow`. Keep additions consistent with the field-guide
// register; don't introduce neons.

export type AnchorKey = "Lilly White" | "Axanthic" | "Harlequin" | "Cappuccino";

export type AnchorPalette = {
  key: AnchorKey;
  hex: string;
  soft: string;
  text: string;
  glow: string;
};

export const ANCHOR_PALETTES: Record<AnchorKey, AnchorPalette> = {
  "Lilly White": {
    key: "Lilly White",
    hex:  "#e9d8a6",   // parchment cream
    soft: "rgba(233,216,166,0.16)",
    text: "#f5ecd0",
    glow: "#fbf6e8",
  },
  Axanthic: {
    key: "Axanthic",
    hex:  "#7ab1d1",   // muted ocean
    soft: "rgba(122,177,209,0.18)",
    text: "#cfe5f1",
    glow: "#a4cce0",
  },
  Harlequin: {
    key: "Harlequin",
    hex:  "#cd6e3c",   // clay-400
    soft: "rgba(205,110,60,0.18)",
    text: "#f0c8aa",
    glow: "#dc8c63",
  },
  Cappuccino: {
    key: "Cappuccino",
    hex:  "#8e4521",   // clay-600, coffee brown
    soft: "rgba(142,69,33,0.22)",
    text: "#e9b394",
    glow: "#b25929",
  },
};

export const ANCHOR_ORDER: ReadonlyArray<AnchorKey> = [
  "Lilly White",
  "Harlequin",
  "Axanthic",
  "Cappuccino",
];

/**
 * Return the anchor key that best fits a combo or trait string. Looks
 * for the anchor name's substring in the input, ordered so that
 * specific compound traits (Cappuccino family, Harlequin variants)
 * resolve before generic ones. Returns null when no anchor matches.
 */
export function anchorOf(s: string | null | undefined): AnchorKey | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.includes("lilly white")) return "Lilly White";
  if (lower.includes("axanthic")) return "Axanthic";
  if (lower.includes("harlequin")) return "Harlequin";
  if (
    lower.includes("cappuccino") ||
    lower.includes("sable") ||
    lower.includes("frappuccino")
  ) {
    return "Cappuccino";
  }
  return null;
}

/** Convenience: palette by key, with a neutral fallback. */
export function paletteFor(key: AnchorKey | null | undefined): AnchorPalette | null {
  if (!key) return null;
  return ANCHOR_PALETTES[key] ?? null;
}
