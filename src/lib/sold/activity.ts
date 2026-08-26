export type SoldActivityWeek = {
  week_start: string;
  sold_count: number;
};

export type SoldEvent = {
  observed_at: string;
};

function utcWeekStart(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

// Compatibility path while the RPC migration rolls out. This work happens
// once per cache fill, never in the browser and never on every page request.
export function aggregateSoldEvents(events: SoldEvent[]): SoldActivityWeek[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const week = utcWeekStart(event.observed_at);
    if (!week) continue;
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }

  return Array.from(counts, ([week_start, sold_count]) => ({
    week_start,
    sold_count,
  })).sort((a, b) => a.week_start.localeCompare(b.week_start));
}

export function normaliseSoldActivity(
  rows: { week_start: string; sold_count: number | string }[],
): SoldActivityWeek[] {
  return rows
    .map((row) => ({
      week_start: row.week_start,
      sold_count: Number(row.sold_count),
    }))
    .filter(
      (row) =>
        /^\d{4}-\d{2}-\d{2}$/.test(row.week_start) &&
        Number.isFinite(row.sold_count) &&
        row.sold_count >= 0,
    );
}
