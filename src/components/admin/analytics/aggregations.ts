// Pure aggregation helpers for the admin analytics dashboard. No React, no
// Supabase — just date math + bucketing. The dashboard calls these from
// inside useMemo so a period change doesn't trigger a refetch.
import type { Delta, Profile, TimestampedRow, UserEvent } from "./types";

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

// ----------------------------------------------------------------------------
// Period → ISO window boundaries
// ----------------------------------------------------------------------------
export function windowFor(periodDays: number, now = Date.now()) {
  const currStart = now - periodDays * DAY_MS;
  const prevStart = now - 2 * periodDays * DAY_MS;
  return {
    now,
    currStartMs: currStart,
    prevStartMs: prevStart,
    currStartIso: new Date(currStart).toISOString(),
    prevStartIso: new Date(prevStart).toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Percent change — matches the source app's behavior:
//   0 → 0  :   0
//   0 → N  : +100
//   else   : round(((curr - prev) / prev) * 100)
// ----------------------------------------------------------------------------
export function pctChange(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return Math.round(((curr - prev) / prev) * 100);
}

export function deltaFromWindow(
  rows: TimestampedRow[],
  col: keyof TimestampedRow | "t",
  currStartMs: number,
  prevStartMs: number,
  nowMs: number,
): Delta {
  let curr = 0;
  let prev = 0;
  for (const r of rows) {
    const raw = (r as Record<string, unknown>)[col as string] as string | null;
    if (!raw) continue;
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) continue;
    if (t >= currStartMs && t <= nowMs) curr += 1;
    else if (t >= prevStartMs && t < currStartMs) prev += 1;
  }
  return { curr, prev, pct: pctChange(curr, prev) };
}

// ----------------------------------------------------------------------------
// Day bucketing — returns a sorted array of { day: "YYYY-MM-DD", count }
// for the last `nBuckets` days ending today.
// ----------------------------------------------------------------------------
export type DayPoint = { day: string; count: number };

export function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function daySeries(
  rows: Array<{ t: string | null | undefined }>,
  nBuckets: number,
  now = Date.now(),
): DayPoint[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = dayKey(r.t);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: DayPoint[] = [];
  for (let i = nBuckets - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    out.push({ day: d, count: counts.get(d) ?? 0 });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Cumulative-from-seed. Given a flat daily count series and a starting
// cumulative value (e.g. count of users created before the first bucket),
// returns running totals.
// ----------------------------------------------------------------------------
export function cumulative(points: DayPoint[], seed = 0): DayPoint[] {
  let running = seed;
  return points.map((p) => {
    running += p.count;
    return { day: p.day, count: running };
  });
}

// ----------------------------------------------------------------------------
// Active users in the window — union of emails that *created anything* in
// the market data streams. This is the engagement signal we have without
// user_events (geck-inspect is browse-heavy, not post-heavy).
// ----------------------------------------------------------------------------
export function activeUsersInWindow(
  profiles: Profile[],
  uploadEmails: Array<{ uploaded_by: string | null; t: string | null }>,
  alertRows: Array<{ owner_id: string | null; t: string | null }>,
  events: UserEvent[],
  currStartMs: number,
  nowMs: number,
): Set<string> {
  const byId = new Map<string, string | null>();
  for (const p of profiles) byId.set(p.id, p.email);

  const active = new Set<string>();
  const inWindow = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= currStartMs && t <= nowMs;
  };

  for (const u of uploadEmails) {
    if (!inWindow(u.t) || !u.uploaded_by) continue;
    const email = byId.get(u.uploaded_by);
    if (email) active.add(email);
  }
  for (const a of alertRows) {
    if (!inWindow(a.t) || !a.owner_id) continue;
    const email = byId.get(a.owner_id);
    if (email) active.add(email);
  }
  for (const e of events) {
    if (!inWindow(e.created_date) || !e.user_email) continue;
    active.add(e.user_email);
  }
  return active;
}

// ----------------------------------------------------------------------------
// Retention cohort grid — Monday-aligned weeks. Rows: last 8 signup weeks.
// Cols: W+1..W+4 follow-up weeks. A user is "retained in W+N" iff they
// produced any user_events row during that week.
//
// Incomplete weeks are returned as `null` so the renderer can draw "—".
// ----------------------------------------------------------------------------
export type CohortCell = {
  active: number;
  size: number;
  pct: number | null; // null = incomplete week
};

export type CohortRow = {
  weekStartMs: number;
  size: number;
  cells: CohortCell[]; // W+1..W+4
};

export function mondayStart(ms: number): number {
  const d = new Date(ms);
  // getUTCDay: 0..6, Sunday..Saturday. Shift so Monday = 0.
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - dow);
  return d.getTime();
}

export function retentionGrid(
  profiles: Profile[],
  events: UserEvent[],
  nowMs = Date.now(),
  nCohorts = 8,
  nFollowups = 4,
): CohortRow[] {
  // Pre-bucket events: email -> set of Monday-aligned week starts they were active.
  const activeWeeks = new Map<string, Set<number>>();
  for (const e of events) {
    if (!e.user_email) continue;
    const t = Date.parse(e.created_date);
    if (!Number.isFinite(t)) continue;
    const wk = mondayStart(t);
    let set = activeWeeks.get(e.user_email);
    if (!set) {
      set = new Set();
      activeWeeks.set(e.user_email, set);
    }
    set.add(wk);
  }

  // Group signups by Monday-aligned week.
  const cohorts = new Map<number, string[]>();
  for (const p of profiles) {
    if (!p.email) continue;
    const t = Date.parse(p.created_at);
    if (!Number.isFinite(t)) continue;
    const wk = mondayStart(t);
    const arr = cohorts.get(wk);
    if (arr) arr.push(p.email);
    else cohorts.set(wk, [p.email]);
  }

  const thisWeek = mondayStart(nowMs);
  const rows: CohortRow[] = [];
  for (let i = nCohorts - 1; i >= 0; i--) {
    const cohortWk = thisWeek - i * WEEK_MS;
    const emails = cohorts.get(cohortWk) ?? [];
    const size = emails.length;
    const cells: CohortCell[] = [];
    for (let n = 1; n <= nFollowups; n++) {
      const followupWk = cohortWk + n * WEEK_MS;
      const weekEnd = followupWk + WEEK_MS;
      if (weekEnd > nowMs) {
        cells.push({ active: 0, size, pct: null });
        continue;
      }
      let active = 0;
      for (const e of emails) {
        const s = activeWeeks.get(e);
        if (s && s.has(followupWk)) active += 1;
      }
      const pct = size === 0 ? 0 : Math.round((active / size) * 100);
      cells.push({ active, size, pct });
    }
    rows.push({ weekStartMs: cohortWk, size, cells });
  }
  return rows;
}

// ----------------------------------------------------------------------------
// Top-N reducer. Generic — used for page rankings, event-name breakdowns,
// feature-usage bars.
// ----------------------------------------------------------------------------
export function topN<T>(
  items: T[],
  key: (x: T) => string | null | undefined,
  n: number,
): Array<{ key: string; count: number }> {
  const m = new Map<string, number>();
  for (const x of items) {
    const k = key(x);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// Count + unique-user-reach for a list of events, grouped by event_name.
export function eventBreakdown(
  events: UserEvent[],
): Array<{ name: string; count: number; users: number }> {
  const counts = new Map<string, number>();
  const emails = new Map<string, Set<string>>();
  for (const e of events) {
    counts.set(e.event_name, (counts.get(e.event_name) ?? 0) + 1);
    if (e.user_email) {
      let s = emails.get(e.event_name);
      if (!s) {
        s = new Set();
        emails.set(e.event_name, s);
      }
      s.add(e.user_email);
    }
  }
  const out: Array<{ name: string; count: number; users: number }> = [];
  for (const [name, count] of counts)
    out.push({ name, count, users: emails.get(name)?.size ?? 0 });
  out.sort((a, b) => b.count - a.count);
  return out;
}
