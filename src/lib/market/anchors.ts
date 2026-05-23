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

export type AnchorKey = string;

export type AnchorPalette = {
  key: AnchorKey;
  hex: string;
  soft: string;
  text: string;
  glow: string;
};

// Hand-tuned colours for the morphs that have a strong visual
// identity in real life. Anything not in this map falls back to a
// deterministic hash colour (colorForTrait below), so every observed
// trait still renders distinguishable swatches; this is just the
// curated overlay for the ones we know on sight.
export const ANCHOR_PALETTES: Record<string, AnchorPalette> = {
  "Lilly White": {
    key: "Lilly White",
    hex:  "#e9d8a6",
    soft: "rgba(233,216,166,0.16)",
    text: "#f5ecd0",
    glow: "#fbf6e8",
  },
  Axanthic: {
    key: "Axanthic",
    hex:  "#7ab1d1",
    soft: "rgba(122,177,209,0.18)",
    text: "#cfe5f1",
    glow: "#a4cce0",
  },
  Harlequin: {
    key: "Harlequin",
    hex:  "#cd6e3c",
    soft: "rgba(205,110,60,0.18)",
    text: "#f0c8aa",
    glow: "#dc8c63",
  },
  "Extreme Harlequin": {
    key: "Extreme Harlequin",
    hex:  "#b25929",
    soft: "rgba(178,89,41,0.20)",
    text: "#e9b394",
    glow: "#dc8c63",
  },
  Cappuccino: {
    key: "Cappuccino",
    hex:  "#8e4521",
    soft: "rgba(142,69,33,0.22)",
    text: "#e9b394",
    glow: "#b25929",
  },
  Pinstripe: {
    key: "Pinstripe",
    hex:  "#a78bfa",
    soft: "rgba(167,139,250,0.18)",
    text: "#d3c4fc",
    glow: "#c4b5fd",
  },
  Dalmatian: {
    key: "Dalmatian",
    hex:  "#94a3b8",
    soft: "rgba(148,163,184,0.20)",
    text: "#cbd5e1",
    glow: "#cbd5e1",
  },
  "Super Dalmatian": {
    key: "Super Dalmatian",
    hex:  "#64748b",
    soft: "rgba(100,116,139,0.22)",
    text: "#cbd5e1",
    glow: "#94a3b8",
  },
  Tiger: {
    key: "Tiger",
    hex:  "#d9a441",
    soft: "rgba(217,164,65,0.18)",
    text: "#f0d294",
    glow: "#e8be6e",
  },
  Phantom: {
    key: "Phantom",
    hex:  "#6366f1",
    soft: "rgba(99,102,241,0.18)",
    text: "#c7d2fe",
    glow: "#818cf8",
  },
  Red: {
    key: "Red",
    hex:  "#d76d62",
    soft: "rgba(215,109,98,0.20)",
    text: "#f0bbb1",
    glow: "#e89187",
  },
  "Red Base": {
    key: "Red Base",
    hex:  "#b14a40",
    soft: "rgba(177,74,64,0.22)",
    text: "#e0a299",
    glow: "#d76d62",
  },
  Tangerine: {
    key: "Tangerine",
    hex:  "#f59e0b",
    soft: "rgba(245,158,11,0.18)",
    text: "#fde0a8",
    glow: "#fbbf24",
  },
  Orange: {
    key: "Orange",
    hex:  "#fb923c",
    soft: "rgba(251,146,60,0.18)",
    text: "#fed7aa",
    glow: "#fdba74",
  },
  Yellow: {
    key: "Yellow",
    hex:  "#facc15",
    soft: "rgba(250,204,21,0.16)",
    text: "#fef3c7",
    glow: "#fde047",
  },
  Cream: {
    key: "Cream",
    hex:  "#fde68a",
    soft: "rgba(253,230,138,0.16)",
    text: "#fef3c7",
    glow: "#fef3c7",
  },
  Lavender: {
    key: "Lavender",
    hex:  "#c084fc",
    soft: "rgba(192,132,252,0.18)",
    text: "#e9d5ff",
    glow: "#d8b4fe",
  },
  Brindle: {
    key: "Brindle",
    hex:  "#8b5a2b",
    soft: "rgba(139,90,43,0.22)",
    text: "#d6a677",
    glow: "#b07a3c",
  },
  Moonglow: {
    key: "Moonglow",
    hex:  "#cbd5e1",
    soft: "rgba(203,213,225,0.20)",
    text: "#e2e8f0",
    glow: "#e2e8f0",
  },
  Snowflake: {
    key: "Snowflake",
    hex:  "#e0f2fe",
    soft: "rgba(224,242,254,0.18)",
    text: "#e0f2fe",
    glow: "#bae6fd",
  },
  Sable: {
    key: "Sable",
    hex:  "#4b3621",
    soft: "rgba(75,54,33,0.30)",
    text: "#c6a37a",
    glow: "#6b4a2b",
  },
  Frappuccino: {
    key: "Frappuccino",
    hex:  "#a07355",
    soft: "rgba(160,115,85,0.22)",
    text: "#d9b993",
    glow: "#b88871",
  },
  "Soft Scale": {
    key: "Soft Scale",
    hex:  "#10b981",
    soft: "rgba(16,185,129,0.18)",
    text: "#a7f3d0",
    glow: "#34d399",
  },
};

// Stable hash → HSL fallback palette for traits we don't have a hand
// tuned colour for. Same input always returns the same output so a
// trait's colour is consistent everywhere it appears.
const FALLBACK_LIGHTNESS = 62;
const FALLBACK_SATURATION = 55;
function hashToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

export function colorForTrait(trait: string): AnchorPalette {
  const direct = ANCHOR_PALETTES[trait];
  if (direct) return direct;
  // Case-insensitive lookup before falling back to a hash.
  for (const k of Object.keys(ANCHOR_PALETTES)) {
    if (k.toLowerCase() === trait.toLowerCase()) return ANCHOR_PALETTES[k]!;
  }
  const hue = hashToHue(trait);
  const hex = hslToHex(hue, FALLBACK_SATURATION, FALLBACK_LIGHTNESS);
  return {
    key: trait,
    hex,
    soft: `hsla(${hue},${FALLBACK_SATURATION}%,${FALLBACK_LIGHTNESS}%,0.18)`,
    text: hslToHex(hue, 40, 80),
    glow: hslToHex(hue, 55, 72),
  };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (v: number): string => {
    const x = Math.round(255 * v);
    return x.toString(16).padStart(2, "0");
  };
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Default ordering. Used by the curated four-up tile band where order
// matters; data-driven surfaces can pass their own order instead.
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

/** Convenience: palette by key. Returns null only for null/empty input;
 *  any non-empty trait string resolves to either a curated palette or a
 *  stable hash-based one via colorForTrait. */
export function paletteFor(key: AnchorKey | null | undefined): AnchorPalette | null {
  if (!key) return null;
  return colorForTrait(key);
}
