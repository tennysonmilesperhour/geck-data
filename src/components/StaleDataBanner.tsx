// Site-wide coverage warning. Rendered from the root layout on every public
// page, so a visitor cannot price a gecko off June medians without being told
// they are June medians (which is exactly what happened during the June 2026
// outage, when the site served four-week-old data with no visible warning).
//
// It used to key off max(last_seen_at) with a 48h rule, which was wrong in
// both directions. One fresh batch of 565 rows cleared the warning while
// 9,274 rows sat unobserved behind it, and now that the ingest is a weekly
// MorphMarket API pull rather than a nightly walk, a perfectly healthy
// pipeline would trip the alarm from midweek onward every single week.
// The banner now reads the same coverage verdict the header pip reads:
// what share of the live catalogue was re-observed, how long ago the last
// pass ran, and how old the newest sale is.
//
// Server component; reads via the anon key. Fails closed to "no banner" on a
// query error or an unreadable verdict, so a Supabase hiccup can never take
// down every page, and never silently downgrades a real warning to silence.

import Link from "next/link";
import {
  getMarketCoverage,
  marketFeedVerdict,
  type MarketCoverage,
} from "@/lib/market/freshness";

const TONE = {
  stale: "border-danger/30 bg-danger/10 text-danger",
  partial: "border-busy/30 bg-busy/10 text-busy",
} as const;

export default async function StaleDataBanner() {
  let coverage: MarketCoverage | null = null;
  try {
    coverage = await getMarketCoverage();
  } catch {
    return null;
  }
  if (!coverage) return null;

  const verdict = marketFeedVerdict(coverage);
  if (verdict.level !== "stale" && verdict.level !== "partial") return null;

  // Observed days say something coverage percentages cannot: how many
  // distinct days in the window produced any observation at all.
  const observed =
    coverage.observedDays30 === null
      ? null
      : `${coverage.observedDays30} of the last 30 days produced observations.`;

  return (
    <div
      className={`border-b px-4 py-2 text-center text-sm ${TONE[verdict.level]}`}
      role="status"
    >
      <span className="font-medium">{verdict.headline}.</span>{" "}
      <span className="opacity-90">
        The market feed is a weekly pulse, not a daily refresh. {verdict.detail}{" "}
        {observed ? `${observed} ` : ""}
        Prices and trends below describe what was last observed, not today.
      </span>{" "}
      <Link href="/status" className="underline decoration-dotted hover:opacity-80">
        Pipeline status
      </Link>
    </div>
  );
}
