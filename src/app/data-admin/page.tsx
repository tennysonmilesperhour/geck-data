// Data Admin home. Four header cards, last 10 scrape runs, and three
// manual trigger buttons (one per scrape type). Intentionally ugly v1.

import {
  getAdminHomeStats,
  getRecentScrapeRuns,
} from "@/lib/geck-data/queries";
import { TriggerScrapeButtons } from "./TriggerScrapeButtons";

export const dynamic = "force-dynamic";

function formatPrice(value: number | null): string {
  if (value === null) return "-";
  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function statusBadge(status: string): string {
  switch (status) {
    case "success":
      return "bg-emerald-900/40 text-emerald-200 border-emerald-700";
    case "partial":
      return "bg-amber-900/40 text-amber-200 border-amber-700";
    case "failed":
      return "bg-red-900/40 text-red-200 border-red-700";
    case "running":
      return "bg-sky-900/40 text-sky-200 border-sky-700";
    default:
      return "bg-ink-800 text-ink-200 border-ink-700";
  }
}

export default async function DataAdminHome() {
  const [stats, runs] = await Promise.all([
    getAdminHomeStats(),
    getRecentScrapeRuns(10),
  ]);

  const mostRecent = stats.most_recent_run;

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Active listings" value={stats.active_listings.toLocaleString()} />
        <Card
          label="Average asking price"
          value={formatPrice(stats.avg_price)}
        />
        <Card
          label="Unique sellers"
          value={stats.unique_sellers.toLocaleString()}
        />
        <Card
          label="Most recent scrape"
          value={
            mostRecent
              ? `${mostRecent.scrape_type} (${mostRecent.status})`
              : "none yet"
          }
          sub={mostRecent ? formatDateTime(mostRecent.started_at) : undefined}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-300">
          Last 10 scrape runs
        </h2>
        <div className="overflow-x-auto rounded-md border border-ink-700 bg-ink-850">
          <table className="w-full text-sm">
            <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-3 py-2">id</th>
                <th className="px-3 py-2">type</th>
                <th className="px-3 py-2">status</th>
                <th className="px-3 py-2">started</th>
                <th className="px-3 py-2">duration</th>
                <th className="px-3 py-2">attempt / ok / fail</th>
                <th className="px-3 py-2">trigger</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const dur =
                  r.finished_at && r.started_at
                    ? Math.round(
                        (new Date(r.finished_at).getTime() -
                          new Date(r.started_at).getTime()) /
                          1000,
                      )
                    : null;
                return (
                  <tr key={r.id} className="border-t border-ink-800">
                    <td className="px-3 py-2 font-mono text-ink-300">{r.id}</td>
                    <td className="px-3 py-2 text-ink-100">{r.scrape_type}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded border px-2 py-0.5 text-xs ${statusBadge(r.status)}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-300">
                      {formatDateTime(r.started_at)}
                    </td>
                    <td className="px-3 py-2 text-ink-300">
                      {dur === null ? "-" : `${dur}s`}
                    </td>
                    <td className="px-3 py-2 text-ink-300">
                      {r.records_attempted ?? 0} / {r.records_succeeded ?? 0} /{" "}
                      {r.records_failed ?? 0}
                    </td>
                    <td className="px-3 py-2 text-ink-300">
                      {r.triggered_by ?? "-"}
                    </td>
                  </tr>
                );
              })}
              {runs.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-4 text-center text-ink-400"
                  >
                    No scrape runs yet. Use the buttons below to trigger one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-300">
          Run a scrape
        </h2>
        <p className="mb-3 text-xs text-ink-400">
          Each button POSTs to /api/trigger-scrape which dispatches the
          matching workflow_dispatch event on GitHub Actions. The job appears
          in the table above within ~30 seconds after the runner picks it up.
        </p>
        <TriggerScrapeButtons />
      </section>
    </div>
  );
}

function Card({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-ink-700 bg-ink-850 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink-50">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}
