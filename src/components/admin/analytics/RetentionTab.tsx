"use client";
// Retention tab — weekly signup cohort × W+1..W+4 follow-up activity.
// Incomplete weeks render "—" so a half-elapsed week can't be misread as a
// retention cliff. Cell color saturates at 60% (the source app's pragmatic
// ceiling — few SaaS products hit 100% weekly retention).
import { useMemo } from "react";
import { Panel } from "@/components/ui/Panel";
import { retentionGrid, type CohortRow } from "./aggregations";
import type { DataBundle } from "./types";

export default function RetentionTab({ data }: { data: DataBundle | null }) {
  const rows = useMemo<CohortRow[] | null>(
    () => (data ? retentionGrid(data.profiles, data.events) : null),
    [data],
  );

  if (!data || !rows) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-800 p-8 text-sm text-ink-400">
        Loading retention grid…
      </div>
    );
  }

  const anyCohort = rows.some((r) => r.size > 0);
  if (!anyCohort) {
    return (
      <Panel
        title="Not enough cohorts yet"
        subtitle="Weekly retention needs at least a few signups per week and matching user_events activity."
      >
        <p className="text-sm text-ink-300">
          Once signups accumulate and the telemetry module is called from the
          app, each row below will show the percentage of that cohort that was
          active in the following weeks.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Weekly retention"
      subtitle="Rows are signup weeks (Monday-aligned). Columns are W+1..W+4. Incomplete weeks render as —; color saturates at 60%."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
              <th className="px-3 py-2 text-left">Cohort week</th>
              <th className="px-3 py-2 text-right">Size</th>
              {[1, 2, 3, 4].map((n) => (
                <th key={n} className="px-3 py-2 text-center">
                  W+{n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/60">
            {rows.map((r) => (
              <tr key={r.weekStartMs}>
                <td className="px-3 py-2 font-mono text-xs text-ink-200">
                  {new Date(r.weekStartMs).toISOString().slice(0, 10)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-300">
                  {r.size.toLocaleString()}
                </td>
                {r.cells.map((c, i) => {
                  if (c.pct == null || r.size === 0) {
                    return (
                      <td
                        key={i}
                        className="px-3 py-2 text-center font-mono text-xs text-ink-500"
                      >
                        —
                      </td>
                    );
                  }
                  const alpha = 0.1 + Math.min(1, c.pct / 60) * 0.45;
                  return (
                    <td
                      key={i}
                      className="px-3 py-2 text-center font-mono text-xs tabular-nums text-ink-100"
                      style={{ backgroundColor: `rgba(16, 185, 129, ${alpha})` }}
                      title={`${c.active}/${c.size} active`}
                    >
                      {c.pct}%
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
