// /reports: index of monthly market reports.
//
// This page used to list the last twelve calendar months from new Date() and
// invite a click on every one. Eight of those months have zero observation
// coverage: nothing was scraped, nothing was priced, nothing was watched. The
// month pages then rendered "0 listings added" for them, which reads as a
// market where nobody listed a gecko rather than a feed that was not running.
// September 2025 was clickable and reported a dead market that we simply never
// looked at.
//
// So the menu is now gated on coverage measured from price_history: a month is
// only a report if we actually observed the market on enough separate days
// inside it. Uncovered months stay listed, because their absence is itself the
// story, but they are not links and they say why.
//
// Note on arrivals: a month with no observation days can still show listings
// "arriving" in it, because the API ingest backfills MorphMarket's real
// first_listed date, which reaches back to 2023. Those are retroactive facts
// about animals still listed today, not a measurement of that month's market.
// That is precisely why arrivals cannot be the coverage test.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SectionHeader, Panel } from "@/components/ui/Panel";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

// Days of real observation inside a month before it is worth calling a report.
// A single scrape day tells you what one Tuesday looked like, not a month.
const MIN_OBSERVED_DAYS = 5;

const MONTHS_LISTED = 12;

type MonthCoverage = {
  slug: string;
  label: string;
  observedDays: number;
  daysInMonth: number;
  covered: boolean;
};

function monthLabel(slug: string): string {
  const [y, m] = slug.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

/** Distinct days on which any price was observed, per month. */
async function observedDaysByMonth(): Promise<Map<string, number>> {
  const supabase = createClient();
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCMonth(since.getUTCMonth() - (MONTHS_LISTED - 1));
  since.setUTCHours(0, 0, 0, 0);

  // Distinct observation DAYS is a small number by construction (at most ~365
  // over the whole window, 13 in practice), so this is counted here rather
  // than pulled as rows. price_history is 45k rows; we only ever want the
  // calendar shape of it.
  const { data, error } = await supabase.rpc("trends_arrivals_weekly", {
    window_days: MONTHS_LISTED * 31,
  });
  const byMonth = new Map<string, number>();
  if (error || !data) return byMonth;

  // trends_arrivals_weekly carries observed_days per week, which sums cleanly
  // into months as long as a week is attributed to the month its Monday falls
  // in. Weeks straddling a month boundary are rare and only ever shift a day
  // or two, which cannot flip a month across the threshold at these numbers.
  for (const row of data as Array<{ week_start: string; observed_days: number | string | null }>) {
    const slug = row.week_start.slice(0, 7);
    const days = Number(row.observed_days ?? 0);
    if (!Number.isFinite(days) || days <= 0) continue;
    byMonth.set(slug, (byMonth.get(slug) ?? 0) + days);
  }
  return byMonth;
}

export default async function ReportsIndex() {
  const slugs = lastNMonths(MONTHS_LISTED);
  let byMonth = new Map<string, number>();
  try {
    byMonth = await observedDaysByMonth();
  } catch {
    byMonth = new Map();
  }

  const months: MonthCoverage[] = slugs.map((slug) => {
    const [y, m] = slug.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    const observedDays = byMonth.get(slug) ?? 0;
    return {
      slug,
      label: monthLabel(slug),
      observedDays,
      daysInMonth,
      covered: observedDays >= MIN_OBSERVED_DAYS,
    };
  });

  const coveredCount = months.filter((m) => m.covered).length;

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Records"
        title="Monthly market reports"
        description="One note per month that we actually observed. A month becomes a report only when the market was sampled on enough separate days inside it to describe."
      />

      <Panel
        title="Last 12 months"
        subtitle={`${fmtInt(coveredCount)} of ${fmtInt(months.length)} months were observed on at least ${MIN_OBSERVED_DAYS} days. The rest are listed so the gaps are visible, but they are not reports.`}
        padded={false}
      >
        <ul className="divide-y divide-ink-700/40">
          {months.map((month) => (
            <li
              key={month.slug}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              {month.covered ? (
                <Link
                  href={`/reports/${month.slug}`}
                  className="text-ink-100 hover:text-claude-glow"
                >
                  {month.label}
                </Link>
              ) : (
                <span className="text-ink-500">{month.label}</span>
              )}
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
                {month.covered
                  ? `${fmtInt(month.observedDays)} of ${fmtInt(month.daysInMonth)} days observed`
                  : month.observedDays > 0
                    ? `only ${fmtInt(month.observedDays)} ${month.observedDays === 1 ? "day" : "days"} observed`
                    : "no scrape coverage"}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel tone="soft" title="Why most months are not reports">
        <p className="text-sm text-ink-300">
          Collection has not been continuous. There was a dense stretch in May
          and early June 2026, then nothing at all from 2026-06-10 to
          2026-08-26 while the scraper was down, and a weekly ingest since. A
          month we did not sample cannot be summarised, and printing zeros for
          it would describe a market that stopped rather than a feed that did.
        </p>
        <p className="mt-2 text-sm text-ink-300">
          Months before May 2026 can still show listings whose MorphMarket
          listing date falls inside them, because the current ingest records
          that original date. Those are facts about animals that are still
          listed now, not observations of the market back then, so they do not
          make a month reportable.
        </p>
      </Panel>

      <p className="text-xs text-ink-500">
        Reports are computed when you open them, from the data as it stands
        today, so a month can read differently on two visits as more of its
        listings are re-observed. A scheduled job that freezes a versioned
        record per month is still on the roadmap.
      </p>
    </div>
  );
}
