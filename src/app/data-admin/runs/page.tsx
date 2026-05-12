// Full scrape_runs history, paginated.

import Link from "next/link";
import { getAllScrapeRuns } from "@/lib/geck-data/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function fmt(value: string | null): string {
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

export default async function RunsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const { rows, total } = await getAllScrapeRuns(page, PAGE_SIZE);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wide text-ink-300">
          Scrape runs ({total.toLocaleString()})
        </h2>
        <Pager page={page} lastPage={lastPage} />
      </div>

      <div className="overflow-x-auto rounded-md border border-ink-700 bg-ink-850">
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-3 py-2">id</th>
              <th className="px-3 py-2">type</th>
              <th className="px-3 py-2">status</th>
              <th className="px-3 py-2">started</th>
              <th className="px-3 py-2">finished</th>
              <th className="px-3 py-2">duration</th>
              <th className="px-3 py-2 text-right">attempt</th>
              <th className="px-3 py-2 text-right">ok</th>
              <th className="px-3 py-2 text-right">fail</th>
              <th className="px-3 py-2">trigger</th>
              <th className="px-3 py-2">error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dur =
                r.finished_at && r.started_at
                  ? Math.round(
                      (new Date(r.finished_at).getTime() -
                        new Date(r.started_at).getTime()) /
                        1000,
                    )
                  : null;
              return (
                <tr key={r.id} className="border-t border-ink-800 align-top">
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
                    {fmt(r.started_at)}
                  </td>
                  <td className="px-3 py-2 text-ink-300">
                    {fmt(r.finished_at)}
                  </td>
                  <td className="px-3 py-2 text-ink-300">
                    {dur === null ? "-" : `${dur}s`}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-200">
                    {r.records_attempted ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-300">
                    {r.records_succeeded ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right text-red-300">
                    {r.records_failed ?? 0}
                  </td>
                  <td className="px-3 py-2 text-ink-300">
                    {r.triggered_by ?? "-"}
                  </td>
                  <td className="max-w-[40ch] px-3 py-2 text-xs text-red-200">
                    {r.error_message ?? ""}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-ink-400">
                  No scrape runs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} lastPage={lastPage} />
    </div>
  );
}

function Pager({ page, lastPage }: { page: number; lastPage: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <PagerLink page={page - 1} disabled={page <= 1} label="< prev" />
      <span className="text-ink-400">
        page {page} / {lastPage}
      </span>
      <PagerLink
        page={page + 1}
        disabled={page >= lastPage}
        label="next >"
      />
    </div>
  );
}

function PagerLink({
  page,
  disabled,
  label,
}: {
  page: number;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="rounded border border-ink-800 bg-ink-900 px-2 py-1 text-ink-500">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={`/data-admin/runs?page=${page}`}
      className="rounded border border-ink-700 bg-ink-850 px-2 py-1 text-ink-200 hover:border-ink-600"
    >
      {label}
    </Link>
  );
}
