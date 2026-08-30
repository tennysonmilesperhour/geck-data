// Compact seller geography panel. Country and state are intentionally shown
// as separate distributions so parent and child geographies never compete in
// one ranking. Server component: pure data in, JSX out.
import { fmtInt } from "@/lib/format";
import {
  summarizeSellerLocations,
  type LocationCount,
} from "@/lib/sellers/location";

type SellerLocationRow = { seller_location: string | null };

function RankedBars({
  rows,
  denominator,
  limit,
}: {
  rows: LocationCount[];
  denominator: number;
  limit: number;
}) {
  const ranked = rows.slice(0, limit);
  if (ranked.length === 0) return null;
  const maxCount = ranked[0]!.count;

  return (
    <ul className="space-y-2">
      {ranked.map(({ label, count }) => {
        const widthPct = (count / maxCount) * 100;
        const sharePct = denominator > 0 ? (count / denominator) * 100 : 0;
        return (
          <li
            key={label}
            aria-label={`${label}: ${fmtInt(count)} sellers, ${sharePct.toFixed(1)} percent`}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-ink-100">{label}</span>
              <span className="flex items-baseline gap-2 font-mono text-[10px] tabular-nums">
                <span className="text-ink-500">{sharePct.toFixed(1)}%</span>
                <span className="text-ink-200">{fmtInt(count)}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-claude-soft to-claude-glow"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DistributionSection({
  title,
  coverage,
  rows,
  denominator,
  limit,
}: {
  title: string;
  coverage: string;
  rows: LocationCount[];
  denominator: number;
  limit: number;
}) {
  const hidden = rows.slice(limit).reduce((sum, row) => sum + row.count, 0);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-300">
          {title}
        </h3>
        <span className="text-right text-[10px] text-ink-500">{coverage}</span>
      </div>
      <RankedBars rows={rows} denominator={denominator} limit={limit} />
      {hidden > 0 ? (
        <p className="mt-2 text-[10px] text-ink-500">
          {fmtInt(hidden)} sellers across {fmtInt(rows.length - limit)} other{" "}
          {title === "Country" ? "countries" : "states"}
        </p>
      ) : null}
    </div>
  );
}

export default function LocationDistribution({
  rows,
  topN = 5,
}: {
  rows: SellerLocationRow[];
  topN?: number;
}) {
  const summary = summarizeSellerLocations(rows);
  if (summary.countryKnown === 0) return null;

  return (
    <section className="surface p-5">
      <header className="mb-4 border-b border-ink-700/60 pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[18px] font-medium tracking-tight text-ink-50">
            Seller locations
          </h2>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-500">
            profile reported
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-ink-400">
          Country and US state are separated so every row is compared at the
          same geographic level.
        </p>
      </header>

      <div className="space-y-5">
        <DistributionSection
          title="Country"
          coverage={`${fmtInt(summary.countryKnown)} of ${fmtInt(summary.total)} mapped`}
          rows={summary.countries}
          denominator={summary.countryKnown}
          limit={topN}
        />

        {summary.usStateKnown > 0 ? (
          <DistributionSection
            title="US state"
            coverage={`${fmtInt(summary.usStateKnown)} of ${fmtInt(summary.usSellerCount)} US sellers identified`}
            rows={summary.usStates}
            denominator={summary.usStateKnown}
            limit={topN}
          />
        ) : null}
      </div>

      <footer className="mt-4 space-y-1 border-t border-ink-700/60 pt-3 text-[11px] text-ink-500">
        {summary.missing > 0 ? (
          <div>
            {fmtInt(summary.missing)}{" "}
            {summary.missing === 1 ? "seller has" : "sellers have"} no
            location on file.
          </div>
        ) : null}
        {summary.unclassified > 0 ? (
          <div>
            {fmtInt(summary.unclassified)} reported locations could not be
            classified.
          </div>
        ) : null}
      </footer>
    </section>
  );
}
