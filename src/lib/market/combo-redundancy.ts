// Shared filter for auto-discovered trait pairs that are not combos.
//
// v_combo_breadth (migration 0046) and combo_maturity_baselines already
// drop parent/child pairs such as Extreme Harlequin x Harlequin. Public
// lists that still rank those pairs need the same rule, not a new ontology.

export type ComboBreadthFlag = {
  combo_id: string;
  is_redundant_pair?: boolean | null;
};

/** Normalise "Lilly White × Axanthic" and "axanthic x lilly white" to one key. */
export function comboPairKey(name: string): string {
  const parts = name
    .toLowerCase()
    .split(/\s*×\s*|\s+x\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
  return parts.join(" x ");
}

export function redundantComboKeys(
  rows: ReadonlyArray<ComboBreadthFlag>,
): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (row.is_redundant_pair !== true) continue;
    out.add(comboPairKey(row.combo_id));
  }
  return out;
}

export function isRedundantComboName(
  name: string,
  redundantKeys: ReadonlySet<string>,
): boolean {
  return redundantKeys.has(comboPairKey(name));
}
