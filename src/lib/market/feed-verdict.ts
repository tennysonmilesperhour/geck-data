// Pure feed-health logic, deliberately free of any server-only import so it
// can be unit tested directly. freshness.ts does the Supabase read and
// re-exports everything here, so callers keep one import site.
//
// The old freshness rule was max(last_seen_at) younger than 48 hours, which
// answers the wrong question in both directions. It called the feed healthy
// when a single 565 row batch landed on top of 9,274 listings nobody had
// re-observed since June, and it would call a perfectly good weekly pulse an
// outage from midweek onward. What matters is coverage: what share of the
// catalogue the newest pass actually re-confirmed, and how long ago that pass
// ran.

export const FRESH_HOURS = 48;

// One weekly pulse plus a day of slack. Coverage measured over 48h collapses
// to ~0% by Wednesday even when the Monday pass was perfect, so the verdict
// judges the catalogue over a whole cycle and keeps the 48h number for the
// "what landed in the last two days" reading.
export const CYCLE_HOURS = 192;
const CYCLE_DAYS = CYCLE_HOURS / 24;

// Share of the live catalogue that has to be re-observed inside a cycle
// before the feed can claim to describe the market as it stands today.
const COVERAGE_OK_PCT = 80;
const COVERAGE_PARTIAL_PCT = 40;

export type MarketCoverage = {
  totalLive: number | null;
  freshLive: number | null;
  staleLive: number | null;
  /** Share of live listings re-observed inside FRESH_HOURS. */
  coveragePct: number | null;
  /** Share of live listings re-observed inside CYCLE_HOURS. Null if that read failed. */
  cycleCoveragePct: number | null;
  newestObservationAt: string | null;
  observationAgeHours: number | null;
  lastCompletePassAt: string | null;
  observedDays30: number | null;
  observedDays90: number | null;
  newestSoldAt: string | null;
  soldAgeDays: number | null;
  capturedSoldEvents: number | null;
  inferredSoldRecords: number | null;
  freshHours: number;
  cycleHours: number;
};

export type FeedLevel = "ok" | "partial" | "stale" | "unknown";

export type FeedVerdict = {
  level: FeedLevel;
  /** Short enough for the header pip. */
  headline: string;
  /** One or two sentences naming the share, the pass date and the newest sale. */
  detail: string;
};

function shortDate(isoString: string): string {
  const t = Date.parse(isoString);
  if (Number.isNaN(t)) return "an unknown date";
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysSince(isoString: string | null, now: number): number | null {
  if (!isoString) return null;
  const t = Date.parse(isoString);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now - t) / 86_400_000);
}

function agoLabel(days: number): string {
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  const whole = Math.round(days);
  return whole === 1 ? "1 day ago" : `${whole} days ago`;
}

/**
 * Turns a coverage row into the single verdict every surface renders from.
 * Pure, so the banner and the header pip cannot drift apart. `now` is
 * injectable for tests.
 */
export function marketFeedVerdict(
  coverage: MarketCoverage | null,
  now: number = Date.now(),
): FeedVerdict {
  if (!coverage) {
    return {
      level: "unknown",
      headline: "Coverage unavailable",
      detail: "The coverage check did not return, so we cannot say how much of the catalogue is current.",
    };
  }

  // Prefer the cycle window: it survives the midweek lull in a weekly feed,
  // where the 48h window is empty by design rather than by failure.
  const usingCycle = coverage.cycleCoveragePct !== null;
  const cov = usingCycle ? coverage.cycleCoveragePct : coverage.coveragePct;
  const windowHours = usingCycle ? coverage.cycleHours : coverage.freshHours;
  const windowLabel =
    windowHours >= 48 ? `${Math.round(windowHours / 24)} days` : `${windowHours} hours`;

  const passIso = coverage.lastCompletePassAt ?? coverage.newestObservationAt;
  const passAgeDays = daysSince(passIso, now);

  const coverageClause =
    cov === null || coverage.totalLive === null
      ? "The share of the catalogue that is current is unavailable"
      : `${cov.toFixed(1)}% of ${coverage.totalLive.toLocaleString()} listings still marked live were re-observed in the last ${windowLabel}`;

  const passClause =
    passIso === null || passAgeDays === null
      ? "No catalogue pass is on record"
      : `Last pass ${shortDate(passIso)}, ${agoLabel(passAgeDays)}`;

  const soldAgeDays = coverage.soldAgeDays ?? daysSince(coverage.newestSoldAt, now);
  const soldClause =
    coverage.newestSoldAt === null || soldAgeDays === null
      ? "No sale has been recorded yet"
      : `Newest recorded sale ${shortDate(coverage.newestSoldAt)}, ${agoLabel(soldAgeDays)}`;

  const detail = `${coverageClause}. ${passClause}. ${soldClause}.`;

  if (cov === null && passAgeDays === null) {
    return { level: "unknown", headline: "Coverage unavailable", detail };
  }

  // A pulse that never landed is stale no matter what the last pass covered.
  if (passAgeDays !== null && passAgeDays > CYCLE_DAYS) {
    return { level: "stale", headline: "No recent pass", detail };
  }

  if (cov === null) {
    return { level: "unknown", headline: "Coverage unavailable", detail };
  }

  if (cov >= COVERAGE_OK_PCT) {
    return { level: "ok", headline: "Coverage current", detail };
  }

  if (cov >= COVERAGE_PARTIAL_PCT) {
    return { level: "partial", headline: "Partial coverage", detail };
  }

  return { level: "stale", headline: "Coverage stale", detail };
}
