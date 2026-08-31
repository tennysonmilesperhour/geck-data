// Combo-level ask vs ask comparison for the Arbitrage source axis.
//
// KR side: Feedle Air USD asks in cross_platform_listings.
// US side: MorphMarket market_listings flagged live.
// Matching is by auto-discovered trait pair (combosFromListing), the same
// auto-discovery the other combo surfaces use, not pHash. This is not a
// sold-comp and not a click-buy spread.

import { matchCombo, normTrait } from "./combos";

// Tokens that are not morphs, so they never seed a combo. "Normal" is a wild
// type marker; the Feedle group-size words (Quad/Pair/Trio) are trait strings
// on that storefront, not pack sizes, but they are not morphs either.
const NON_MORPH_TOKENS = new Set([
  "normal",
  "unknown",
  "crested",
  "crestedgecko",
  "quad",
  "pair",
  "trio",
  "group",
]);

export const SOURCE_ARB_MIN_N = 3;
export const KR_LABEL = "Feedle Air (KR)";
export const US_LABEL = "MorphMarket (US)";

export type SourceAsk = {
  comboId: string;
  comboDisplay: string;
  priceUsd: number;
};

export type SourceArbRow = {
  combo: string;
  low: { label: string; tag: string; price: number; n: number };
  high: { label: string; tag: string; price: number; n: number };
  spreadAbs: number;
  spreadPct: number;
};

export function medianUsd(values: number[]): number | null {
  const clean = values
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0
    ? (clean[mid - 1]! + clean[mid]!) / 2
    : clean[mid]!;
}

export function comboFromListing(
  traits: string | string[] | null | undefined,
  title: string | null | undefined,
): { id: string; display: string } | null {
  const fromTraits = matchCombo(traits ?? "");
  if (fromTraits) return { id: fromTraits.id, display: fromTraits.display };
  if (title) {
    const fromTitle = matchCombo(title);
    if (fromTitle) return { id: fromTitle.id, display: fromTitle.display };
  }
  return null;
}

/**
 * Every trait pair a listing implies, for the auto-discovered source axis.
 *
 * comboFromListing above maps a listing to at most one of the 12 curated
 * combos, which is why the source tab showed a single row. This instead
 * expands the comma-delimited trait field into all two-trait combinations, so
 * any pair a breeder actually lists can be compared across sources, the same
 * auto-discovery the combo rollup and regional heatmap use. The id is the two
 * normalized tokens sorted and joined, so a Feedle listing and a MorphMarket
 * listing that name the same two morphs land on the same id and group
 * together.
 *
 * A pair is dropped when one trait's normalized token contains the other's
 * (Harlequin x Extreme Harlequin, Dalmatian x Super Dalmatian, Pinstripe x
 * Full Pinstripe): that is one trait restated with a modifier, the dominant
 * case the SQL surfaces drop with _traits_are_redundant. This is a lighter
 * substring check, not that seeded relations table, so a few allelic pairs it
 * would catch can still appear; the n>=3-both-sides floor keeps those rare.
 *
 * Title is deliberately not a fallback here. An unstructured title expands
 * into noisy n-grams, and a pair built from noise would invent a comparison,
 * so a listing with no structured trait field simply yields nothing.
 */
export function combosFromListing(
  traits: string | string[] | null | undefined,
): Array<{ id: string; display: string }> {
  const phrases: string[] = Array.isArray(traits)
    ? traits.map((t) => String(t))
    : typeof traits === "string"
      ? traits.split(/[,;|/]+/)
      : [];
  // Keep the original-case phrase for display, the normalized token for
  // matching. Dedupe by normalized token within the listing.
  const toks: Array<{ norm: string; display: string }> = [];
  const seen = new Set<string>();
  for (const phrase of phrases) {
    const display = phrase.trim();
    const norm = normTrait(display);
    if (norm.length < 2 || NON_MORPH_TOKENS.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    toks.push({ norm, display });
  }
  const out: Array<{ id: string; display: string }> = [];
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      const a = toks[i]!;
      const b = toks[j]!;
      if (a.norm.includes(b.norm) || b.norm.includes(a.norm)) continue;
      const [lo, hi] = a.norm < b.norm ? [a, b] : [b, a];
      out.push({
        id: `${lo.norm}__${hi.norm}`,
        display: `${lo.display} × ${hi.display}`,
      });
    }
  }
  return out;
}

export function looksLikeNonCrested(title: string | null | undefined): boolean {
  if (!title) return false;
  return /gargoyle|leopard gecko|leachie|leachianus|chahoua|fat[\s-]?tail/i.test(
    title,
  );
}

export function payloadFlaggedGroupLot(
  payload: unknown,
): boolean {
  if (!payload || typeof payload !== "object") return false;
  const row = payload as Record<string, unknown>;
  return row.is_group_lot === true || row.exclude_from_combo_arb === true;
}

export function payloadIsSold(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const row = payload as Record<string, unknown>;
  if (row.sold === true) return true;
  if (typeof row.sale_status === "string" && row.sale_status !== "FOR_SALE") {
    return true;
  }
  return false;
}

export function buildSourceArbRows(
  krAsks: SourceAsk[],
  usAsks: SourceAsk[],
  minN: number = SOURCE_ARB_MIN_N,
): SourceArbRow[] {
  const krBy = new Map<string, SourceAsk[]>();
  const usBy = new Map<string, SourceAsk[]>();
  for (const ask of krAsks) {
    const arr = krBy.get(ask.comboId) ?? [];
    arr.push(ask);
    krBy.set(ask.comboId, arr);
  }
  for (const ask of usAsks) {
    const arr = usBy.get(ask.comboId) ?? [];
    arr.push(ask);
    usBy.set(ask.comboId, arr);
  }

  // Every combo present on both sides, not just the 12 curated ones. The ids
  // are auto-discovered trait pairs (combosFromListing), so this is the whole
  // overlap of what Feedle and MorphMarket actually list.
  const rows: SourceArbRow[] = [];
  const bothIds = new Set<string>();
  for (const id of krBy.keys()) if (usBy.has(id)) bothIds.add(id);
  for (const comboId of bothIds) {
    const kr = krBy.get(comboId) ?? [];
    const us = usBy.get(comboId) ?? [];
    if (kr.length < minN || us.length < minN) continue;
    const krMed = medianUsd(kr.map((a) => a.priceUsd));
    const usMed = medianUsd(us.map((a) => a.priceUsd));
    if (krMed == null || usMed == null) continue;
    const spreadAbs = Math.abs(usMed - krMed);
    if (spreadAbs <= 0) continue;
    const lowIsKr = krMed <= usMed;
    const lowPx = lowIsKr ? krMed : usMed;
    const highPx = lowIsKr ? usMed : krMed;
    const spreadPct = lowPx === 0 ? 0 : (spreadAbs / lowPx) * 100;
    rows.push({
      // Label the row from the listing's own display name for the pair.
      combo: kr[0]?.comboDisplay ?? us[0]?.comboDisplay ?? comboId,
      low: {
        label: lowIsKr ? KR_LABEL : US_LABEL,
        tag: "ask",
        price: Math.round(lowPx),
        n: lowIsKr ? kr.length : us.length,
      },
      high: {
        label: lowIsKr ? US_LABEL : KR_LABEL,
        tag: "ask",
        price: Math.round(highPx),
        n: lowIsKr ? us.length : kr.length,
      },
      spreadAbs: Math.round(spreadAbs),
      spreadPct,
    });
  }
  rows.sort((a, b) => b.spreadPct - a.spreadPct);
  return rows;
}
