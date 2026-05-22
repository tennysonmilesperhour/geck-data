// /reports — index of monthly market reports. Each entry is a static
// snapshot of the dashboard's headline metrics for one month, generated
// on demand (or by a scheduled job, later). The current implementation
// lists the last 12 months and lets the visitor click into any to see
// what the dashboard said at the end of that month.
//
// Server-rendered. No backing table yet; we synthesise the menu from
// the current date. The /reports/[month] page does the actual work.
import Link from "next/link";
import { SectionHeader, Panel } from "@/components/ui/Panel";

export const dynamic = "force-dynamic";

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

function monthLabel(slug: string): string {
  const [y, m] = slug.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function ReportsIndex() {
  const months = lastNMonths(12);
  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Records"
        title="Monthly market reports"
        description="A plain-language note for each month, summarising the index moves, biggest gainers and losers by combo, regional notes, and anything anomalous from the cadence data."
      />

      <Panel
        title="Recent months"
        subtitle="Click any month for that month's headline metrics, generated against today's data."
        padded={false}
      >
        <ul className="divide-y divide-ink-700/40">
          {months.map((slug, i) => (
            <li
              key={slug}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <Link
                href={`/reports/${slug}`}
                className="text-ink-100 hover:text-claude-glow"
              >
                {monthLabel(slug)}
              </Link>
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
                {i === 0 ? "current" : "snapshot"}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <p className="text-xs text-ink-500">
        Reports are generated on demand for now. A scheduled job that
        writes a versioned record once per month is on the roadmap.
      </p>
    </div>
  );
}
