// Cross-market comparison rules, kept pure so they are tested once and the
// page only renders. All prices are asking prices in USD.
import type { MarketCell, MarketCode } from "./data";

export type MarketMeta = {
  code: Exclude<MarketCode, "US_SHOPS">;
  name: string;
  currency: string;
  sources: string;
};

export const MARKETS: MarketMeta[] = [
  { code: "US", name: "United States", currency: "USD", sources: "MorphMarket" },
  { code: "KR", name: "South Korea", currency: "KRW", sources: "Feedle and Korean breeder shops" },
  { code: "JP", name: "Japan", currency: "JPY", sources: "Repsuki (Japanese reptile shops)" },
  { code: "EU", name: "Europe", currency: "EUR", sources: "terraristik.com and MorphMarket" },
  { code: "CA", name: "Canada", currency: "CAD", sources: "MorphMarket" },
  { code: "UK", name: "United Kingdom", currency: "GBP", sources: "MorphMarket" },
];

/** A market needs this many listings of a morph before it is compared. */
export const MIN_N = 8;
/** Gaps smaller than this share of the US price are treated as noise. */
export const MIN_GAP = 0.2;

export type Grid = Map<string | null, Map<MarketCode, MarketCell>>;

export function pivot(cells: MarketCell[]): Grid {
  const grid: Grid = new Map();
  for (const c of cells) {
    if (!grid.has(c.trait)) grid.set(c.trait, new Map());
    grid.get(c.trait)!.set(c.market, c);
  }
  return grid;
}

export type Opportunity = {
  trait: string;
  market: MarketCode;
  /** What a buyer pays per gecko in the cheaper market, before shipping. */
  buy: number;
  /** Middle asking price in the pricier market. */
  sell: number;
  /** sell minus buy: the most shipping and fees can cost before the trade stops paying. */
  room: number;
  ratio: number;
  buyN: number;
  sellN: number;
};

const usable = (c: MarketCell | undefined): c is MarketCell & { p50: number } =>
  Boolean(c && c.p50 != null && c.n >= MIN_N);

/**
 * Morphs that ask clearly less in `market` than in the US (direction
 * "import": buy there, sell in the US) or clearly more (direction
 * "export"). `importMarkup` scales the foreign price to what a US buyer
 * actually pays when that market has an export storefront (Feedle Air for
 * Korea). Sorted by room, biggest first.
 */
export function opportunities(
  grid: Grid,
  market: MarketCode,
  direction: "import" | "export",
  importMarkup = 1,
): Opportunity[] {
  const out: Opportunity[] = [];
  for (const [trait, row] of grid) {
    if (trait == null) continue;
    const us = row.get("US");
    const other = row.get(market);
    if (!usable(us) || !usable(other)) continue;
    if (direction === "import") {
      const buy = Math.round(other.p50 * importMarkup);
      if (buy > us.p50 * (1 - MIN_GAP)) continue;
      out.push({ trait, market, buy, sell: us.p50, room: us.p50 - buy, ratio: buy / us.p50, buyN: other.n, sellN: us.n });
    } else {
      if (other.p50 < us.p50 * (1 + MIN_GAP)) continue;
      out.push({ trait, market, buy: us.p50, sell: other.p50, room: other.p50 - us.p50, ratio: other.p50 / us.p50, buyN: us.n, sellN: other.n });
    }
  }
  return out.sort((a, b) => b.room - a.room);
}

/** Morphs with enough listings in the US and at least one other market. */
export function comparableTraits(grid: Grid): string[] {
  const out: Array<{ trait: string; n: number }> = [];
  for (const [trait, row] of grid) {
    if (trait == null || !usable(row.get("US"))) continue;
    const others = MARKETS.filter((m) => m.code !== "US" && usable(row.get(m.code)));
    if (!others.length) continue;
    const n = [...row.values()].reduce((s, c) => s + c.n, 0);
    out.push({ trait, n });
  }
  return out.sort((a, b) => b.n - a.n).map((r) => r.trait);
}

/** "42% less" / "2.6x" style comparison of a price against the US price. */
export function vsUs(price: number, us: number): { text: string; dir: "below" | "above" | "same" } {
  const r = price / us;
  if (Math.abs(r - 1) < 0.05) return { text: "about the same", dir: "same" };
  if (r < 1) return { text: `${Math.round((1 - r) * 100)}% less`, dir: "below" };
  return { text: r >= 1.95 ? `${r.toFixed(1)}x` : `${Math.round((r - 1) * 100)}% more`, dir: "above" };
}
