// Shape weekly history for display. Pure functions so the rules about gaps
// and partial weeks are tested once and every chart follows them.
import type { TrendWeek } from "./data";

const DAY = 86_400_000;

export const weekTime = (w: string) => Date.parse(`${w}T00:00:00Z`);

/** Runs of back-to-back full weeks. A line is only drawn inside a run. */
export function fullRuns(weeks: TrendWeek[]): TrendWeek[][] {
  const runs: TrendWeek[][] = [];
  let cur: TrendWeek[] = [];
  for (const w of weeks) {
    const prev = cur[cur.length - 1];
    const joins = prev && !w.partial && weekTime(w.week) - weekTime(prev.week) === 7 * DAY;
    if (w.partial || w.p50 == null) {
      if (cur.length) runs.push(cur);
      cur = [];
      continue;
    }
    if (!joins && cur.length) {
      runs.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Stretches of a week or more with no scrape at all. */
export function untracked(weeks: TrendWeek[]): Array<{ from: string; to: string; weeks: number }> {
  const out: Array<{ from: string; to: string; weeks: number }> = [];
  for (let i = 1; i < weeks.length; i++) {
    const span = (weekTime(weeks[i].week) - weekTime(weeks[i - 1].week)) / (7 * DAY);
    if (span > 1) out.push({ from: weeks[i - 1].week, to: weeks[i].week, weeks: Math.round(span - 1) });
  }
  return out;
}

export type SaleWeek = { week: string; cuts: number; medianCut: number | null; raisesNext: number | null };

/**
 * The week with unusually many price cuts: at least twice the typical
 * week's cuts across full weeks. Returns null when no week stands out, so
 * the page never invents a sale out of normal churn.
 */
export function saleWeek(weeks: TrendWeek[]): SaleWeek | null {
  const full = weeks.filter((w) => !w.partial && !w.afterGap);
  if (full.length < 3) return null;
  const sorted = full.map((w) => w.cuts).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  const top = full.reduce((a, b) => (b.cuts > a.cuts ? b : a));
  if (typical <= 0 || top.cuts < typical * 2) return null;
  const idx = weeks.indexOf(top);
  const next = weeks[idx + 1];
  const nextIsNextWeek = next && weekTime(next.week) - weekTime(top.week) === 7 * DAY;
  return {
    week: top.week,
    cuts: top.cuts,
    medianCut: top.medianCut,
    raisesNext: nextIsNextWeek ? next.raises : null,
  };
}

/** Change in the middle price from the first to the last full week. */
export function priceChange(weeks: TrendWeek[]): { from: TrendWeek; to: TrendWeek; pct: number } | null {
  const full = weeks.filter((w) => !w.partial && w.p50 != null);
  if (full.length < 2) return null;
  const from = full[0];
  const to = full[full.length - 1];
  if (!from.p50) return null;
  return { from, to, pct: (to.p50! - from.p50) / from.p50 };
}

export function fmtWeek(w: string, withYear = false): string {
  return new Date(weekTime(w)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}
