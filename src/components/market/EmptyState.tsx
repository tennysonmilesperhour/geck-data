"use client";
// Renders the right thing when a /market widget's underlying query has
// no data: a "Loading…" placeholder while the request is in flight, and
// a "No data yet" notice (with the reason) afterwards. Used everywhere
// the dashboard previously rendered a synthetic fixture so the user
// could see *something*. Now we tell the truth.
import type { Status } from "@/lib/market/useFilteredQuery";

export default function EmptyState({
  status,
  label,
  note,
}: {
  status: Status;
  label: string;
  note?: string;
}) {
  if (status === "loading") {
    return (
      <div className="forest-surface p-6 text-sm text-forest-400">
        Loading {label}…
      </div>
    );
  }
  return (
    <div className="forest-surface p-6">
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-busy">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-busy" />
        No data yet
      </div>
      <div className="text-sm text-forest-200">
        {label} hasn&apos;t produced any rows for the current filters.
      </div>
      {note ? (
        <div className="mt-1 font-mono text-[11px] text-forest-500">{note}</div>
      ) : null}
    </div>
  );
}
