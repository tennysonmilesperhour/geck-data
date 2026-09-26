// How each crested gecko trait is inherited, in plain words. This is the
// organizing idea behind the Morphs page: a buyer pays for genes they can
// breed from differently than for a pattern or color that is line-bred.
//
// Source of truth for the genes is the Geck Inspect genetics catalog
// (geck-inspect: src/lib/genetics/calculatorCatalog.js). Keep the two in
// step. Anything not listed as a gene here is treated as line-bred: it is
// selected over generations and does not follow simple Punnett odds.

export type TraitGroup = "gene" | "pattern" | "color";

export type TraitInfo = {
  group: TraitGroup;
  /** Short inheritance label, e.g. "Recessive gene". */
  kind: string;
  /** One or two plain sentences. */
  note: string;
  /** "emerging" means documented by few breeders so far. */
  confidence?: "proven" | "emerging";
};

const GENES: Record<string, TraitInfo> = {
  "Lilly White": {
    group: "gene",
    kind: "Incomplete dominant gene",
    confidence: "proven",
    note: "One copy gives the Lilly White look. Two copies are lethal in the egg, so every Lilly White carries exactly one.",
  },
  Axanthic: {
    group: "gene",
    kind: "Recessive gene",
    confidence: "proven",
    note: "Needs two copies to show. Visual Axanthics lack red and yellow pigment: black, white and silver.",
  },
  "Het Axanthic": {
    group: "gene",
    kind: "Hidden recessive carrier",
    confidence: "proven",
    note: "Carries one hidden copy of Axanthic. Looks normal, but paired with another carrier can make Axanthic babies.",
  },
  Phantom: {
    group: "gene",
    kind: "Recessive gene",
    confidence: "proven",
    note: "Needs two copies to show. Mutes pattern color. Hidden carriers explain many surprise hatchlings.",
  },
  "Empty Back": {
    group: "gene",
    kind: "Incomplete dominant gene",
    confidence: "proven",
    note: "Reduces the pattern along the back. Two copies strip nearly all back markings.",
  },
  Cappuccino: {
    group: "gene",
    kind: "Incomplete dominant gene",
    confidence: "proven",
    note: "Shares a gene with Sable. Two copies (Super Cappuccino) carry severe health problems; Cappuccino x Sable makes Luwak instead.",
  },
  Sable: {
    group: "gene",
    kind: "Incomplete dominant gene",
    confidence: "proven",
    note: "Shares a gene with Cappuccino. Sable x Cappuccino produces Luwak.",
  },
  "Soft Scale": {
    group: "gene",
    kind: "Incomplete dominant gene",
    confidence: "emerging",
    note: "Softer looking scales. Documented by a few breeders so far, so treat the genetics as emerging.",
  },
  Hypo: {
    group: "gene",
    kind: "Dominant gene",
    confidence: "emerging",
    note: "Reduced dark pigment. Long line-bred; single-gene claims are still being proven.",
  },
};

// Base colors from the crested taxonomy (category = color, not a gene).
const COLORS = new Set([
  "Red",
  "Yellow",
  "Orange",
  "Dark",
  "Cream",
  "Olive",
  "Tangerine",
  "Lavender",
  "Buckskin",
  "Red Base",
  "Yellow Base",
  "Dark Base",
]);

export function traitInfo(trait: string): TraitInfo {
  const gene = GENES[trait];
  if (gene) return gene;
  if (COLORS.has(trait)) {
    return {
      group: "color",
      kind: "Line-bred color",
      note: "Base color is shaped over generations of selective pairing, not by a single gene.",
    };
  }
  return {
    group: "pattern",
    kind: "Line-bred pattern",
    note: "Pattern strength is shaped over generations of selective pairing, not by a single gene.",
  };
}

export const GROUPS: Array<{ id: TraitGroup; title: string; blurb: string }> = [
  {
    id: "gene",
    title: "Genes",
    blurb: "Traits with predictable inheritance. You can plan pairings around them.",
  },
  {
    id: "pattern",
    title: "Patterns",
    blurb: "Line-bred over generations. Quality varies a lot from gecko to gecko.",
  },
  {
    id: "color",
    title: "Colors",
    blurb: "Line-bred base colors. Often shift with age and mood (fired up or down).",
  },
];
