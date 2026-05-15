// Starter glossary for the most common crested gecko morphs / traits.
// Used by <MorphTerm /> to surface a beginner-friendly explanation on
// hover/focus anywhere combo names appear.
//
// Keys are lowercased and trimmed for case-insensitive lookup. The
// component handles splitting compound combo strings (e.g. "Lilly White
// × Pinstripe") and looking up each part. Unknown parts render plain.
//
// Descriptions are intentionally one-sentence, beginner-aimed, and
// avoid claims about market value or rarity — the rest of the app
// surfaces those numerically.

export type GlossaryEntry = {
  /** Canonical display name. */
  name: string;
  /** One-sentence description in plain language. */
  description: string;
  /** Optional aliases that should resolve to this entry. */
  aliases?: ReadonlyArray<string>;
};

const ENTRIES: ReadonlyArray<GlossaryEntry> = [
  {
    name: "Lilly White",
    description:
      "A bright base morph that reduces dark pigment across the body. Often paired with patterns like Pinstripe or Harlequin.",
    aliases: ["lilly"],
  },
  {
    name: "Axanthic",
    description:
      "A recessive trait that removes yellow and red pigments, producing a high-contrast greyscale gecko.",
    aliases: ["axanthic"],
  },
  {
    name: "Pinstripe",
    description:
      "A pattern trait where raised scales along the dorsum form clean stripes from neck to tail base.",
    aliases: ["pin", "pinstripes"],
  },
  {
    name: "Reverse Pinstripe",
    description:
      "Pinstripe in which the lateral stripes are lighter than the surrounding body, instead of darker.",
    aliases: ["reverse pin"],
  },
  {
    name: "Harlequin",
    description:
      "A high-contrast pattern morph with bold, broken patches of color across the body and legs.",
    aliases: ["harli"],
  },
  {
    name: "Extreme Harlequin",
    description:
      "A higher-expression Harlequin where the patterning extends further up the back and along the limbs.",
    aliases: ["xh", "extreme harli", "extreme harly"],
  },
  {
    name: "Tiger",
    description:
      "Vertical dark bands across the dorsum, like a tiger's stripes.",
    aliases: [],
  },
  {
    name: "Brindle",
    description:
      "Irregular, streaky pattern reminiscent of brindle dog coats.",
    aliases: [],
  },
  {
    name: "Flame",
    description:
      "A clean dorsal pattern with cream-to-orange flame shapes running down the back.",
    aliases: [],
  },
  {
    name: "Dalmatian",
    description:
      "Dark spots scattered across the body, like the dog breed.",
    aliases: ["dal", "dals", "super dalmatian", "super dal"],
  },
  {
    name: "Phantom",
    description:
      "A pattern-reducer that masks pinstripe and dorsal pattern, leaving a moody shadow of what's underneath.",
    aliases: [],
  },
  {
    name: "Patternless",
    description:
      "Solid base color with no visible pattern. Sometimes called Solid.",
    aliases: ["solid"],
  },
  {
    name: "Cappuccino",
    description:
      "A warm tan to coffee-brown base color that pairs cleanly with most patterns.",
    aliases: ["cap", "capp"],
  },
  {
    name: "Halloween",
    description:
      "Dark, near-black base with bright orange or red highlights.",
    aliases: [],
  },
  {
    name: "Moonglow",
    description:
      "Pale, near-white morph with reduced melanin and an ethereal glow.",
    aliases: [],
  },
  {
    name: "Lavender",
    description:
      "A purple-tinted grey base color.",
    aliases: [],
  },
  {
    name: "Sable",
    description:
      "A deep brown to near-black base color.",
    aliases: [],
  },
  {
    name: "Cream",
    description:
      "A pale cream-to-ivory base color, often paired with bold patterns.",
    aliases: [],
  },
  {
    name: "Red",
    description:
      "A red-based gecko — usually red dorsum with light flanks.",
    aliases: [],
  },
  {
    name: "Tricolor",
    description:
      "Three-color geckos, typically combining cream, red, and a darker tone.",
    aliases: ["tri", "tri-color"],
  },
  {
    name: "Quadstripe",
    description:
      "A Pinstripe variant with four lateral stripes instead of two.",
    aliases: ["quad"],
  },
];

// Build a case-insensitive lookup once at module load.
const INDEX = new Map<string, GlossaryEntry>();
for (const entry of ENTRIES) {
  INDEX.set(entry.name.toLowerCase().trim(), entry);
  for (const alias of entry.aliases ?? []) {
    INDEX.set(alias.toLowerCase().trim(), entry);
  }
}

export function lookupMorph(term: string): GlossaryEntry | null {
  if (!term) return null;
  return INDEX.get(term.toLowerCase().trim()) ?? null;
}

// Split a compound combo string ("Lilly White × Pinstripe", "Tiger x
// Cream", "Phantom Harli") into individual term tokens. Tries the
// well-known separators (×, x, +, /) and otherwise returns the whole
// string as one token.
export function splitComboParts(combo: string): string[] {
  if (!combo) return [];
  // Split on × | " x " | + | / — but not "Extreme" + word combinations.
  // Conservative: only split when there's an explicit separator with
  // whitespace around it, so we don't break "Lilly White" into "Lilly"
  // and "White".
  return combo
    .split(/\s*(?:×|\sx\s|\+|\/)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}
