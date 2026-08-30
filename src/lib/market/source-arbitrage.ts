// Combo-level ask vs ask comparison for the Arbitrage source axis.
//
// KR side: Feedle Air USD asks in cross_platform_listings.
// US side: MorphMarket market_listings flagged live.
// Matching is HIGH_VALUE_COMBOS on traits/title, not pHash. This is not
// a sold-comp and not a click-buy spread.

import { HIGH_VALUE_COMBOS, matchCombo } from "./combos";

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

  const rows: SourceArbRow[] = [];
  for (const combo of HIGH_VALUE_COMBOS) {
    const kr = krBy.get(combo.id) ?? [];
    const us = usBy.get(combo.id) ?? [];
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
      combo: combo.display,
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
