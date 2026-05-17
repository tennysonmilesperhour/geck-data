// /data-admin/control
//
// Unified API + spend + quota panel. Replaces the role of the Overview
// page over time. Three sections:
//   1. Spend (7d)     — Anthropic $ from model_invocations, by surface
//                       and by day. Errors and call counts alongside.
//   2. Workflow runs  — scrape_runs + morph_eval_runs joined and sorted.
//   3. Quota controls — runtime_config knobs editable with audit trail.

import {
  getSpend7d,
  getCombinedRuns,
  getRuntimeConfig,
  getReconciliation7d,
} from "@/lib/geck-data/queries";
import { QuotaControls } from "./QuotaControls";

export const dynamic = "force-dynamic";

function formatCents(c: number): string {
  if (!Number.isFinite(c) || c === 0) return "$0.00";
  return `$${(c / 100).toFixed(c < 100 ? 4 : 2)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatDay(value: string): string {
  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

function surfaceBadge(surface: string): string {
  switch (surface) {
    case "morph_id_production":
      return "bg-violet-900/40 text-violet-200 border-violet-700";
    case "morph_id_eval":
      return "bg-sky-900/40 text-sky-200 border-sky-700";
    case "morph_id_train":
      return "bg-amber-900/40 text-amber-200 border-amber-700";
    default:
      return "bg-ink-800 text-ink-200 border-ink-700";
  }
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

export default async function ControlPanel() {
  const [spend, runs, config, recon] = await Promise.all([
    getSpend7d(),
    getCombinedRuns(20),
    getRuntimeConfig(),
    getReconciliation7d(),
  ]);

  const surfaceEntries = Object.entries(spend.by_surface).sort(
    (a, b) => b[1].cost_cents - a[1].cost_cents,
  );

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">
            Spend (last 7 days)
          </h2>
          <div className="text-xs text-ink-400">
            {spend.total_calls.toLocaleString()} calls,
            {" "}
            {spend.total_errors > 0 && (
              <span className="text-red-300">
                {spend.total_errors.toLocaleString()} errors,
                {" "}
              </span>
            )}
            {formatCents(spend.total_cents)} total
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {surfaceEntries.length === 0 ? (
            <div className="col-span-full rounded-md border border-ink-700 bg-ink-850 p-4 text-sm text-ink-400">
              No model_invocations rows yet. Next MorphID call (production
              or eval) will populate this panel.
            </div>
          ) : (
            surfaceEntries.map(([surface, totals]) => (
              <SurfaceCard
                key={surface}
                surface={surface}
                calls={totals.calls}
                cents={totals.cost_cents}
              />
            ))
          )}
        </div>

        {spend.by_day.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-md border border-ink-700 bg-ink-850">
            <table className="w-full text-sm">
              <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-3 py-2">day</th>
                  <th className="px-3 py-2">calls</th>
                  <th className="px-3 py-2">cost</th>
                  <th className="px-3 py-2">bar</th>
                </tr>
              </thead>
              <tbody>
                {spend.by_day.map((d) => {
                  const max = Math.max(
                    1,
                    ...spend.by_day.map((x) => x.cost_cents),
                  );
                  const pct = Math.round((d.cost_cents / max) * 100);
                  return (
                    <tr key={d.day} className="border-t border-ink-800">
                      <td className="px-3 py-2 text-ink-100">{formatDay(d.day)}</td>
                      <td className="px-3 py-2 text-ink-300">
                        {d.calls.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-ink-100">
                        {formatCents(d.cost_cents)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="h-2 w-32 rounded-full bg-ink-800">
                          <div
                            className="h-2 rounded-full bg-violet-500/60"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">
            Reconciliation (estimated vs actual)
          </h2>
          <span className="text-xs text-ink-400">
            {recon.most_recent_fetch
              ? `Anthropic billing last pulled ${new Date(recon.most_recent_fetch).toLocaleString()}`
              : "Anthropic billing never pulled — run pull_anthropic_billing.py"}
          </span>
        </div>
        <ReconciliationTable recon={recon} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-300">
          Workflow runs (scrapes + evals, last 20)
        </h2>
        <div className="overflow-x-auto rounded-md border border-ink-700 bg-ink-850">
          <table className="w-full text-sm">
            <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-3 py-2">kind</th>
                <th className="px-3 py-2">label</th>
                <th className="px-3 py-2">status</th>
                <th className="px-3 py-2">started</th>
                <th className="px-3 py-2">detail</th>
                <th className="px-3 py-2">trigger</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-4 text-center text-ink-400"
                  >
                    No runs yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-t border-ink-800">
                    <td className="px-3 py-2">
                      <span
                        className={`rounded border px-2 py-0.5 text-xs ${
                          r.kind === "eval"
                            ? "border-sky-700 bg-sky-900/40 text-sky-200"
                            : "border-violet-700 bg-violet-900/40 text-violet-200"
                        }`}
                      >
                        {r.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-100">{r.label}</td>
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
                    <td className="px-3 py-2 text-ink-300">{r.detail}</td>
                    <td className="px-3 py-2 text-ink-300">
                      {r.triggered_by ?? "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">
            Quota controls
          </h2>
          <span className="text-xs text-ink-400">
            Edits write to runtime_config + runtime_config_history audit table.
          </span>
        </div>
        <QuotaControls rows={config} />
      </section>
    </div>
  );
}

function ReconciliationTable({
  recon,
}: {
  recon: Awaited<ReturnType<typeof getReconciliation7d>>;
}) {
  if (recon.days.length === 0) {
    return (
      <div className="rounded-md border border-ink-700 bg-ink-850 p-4 text-sm text-ink-400">
        No spend data yet. The first MorphID call (production or eval)
        populates the Estimated column; running pull_anthropic_billing.py
        populates Actual.
      </div>
    );
  }
  const totalDeltaCents =
    recon.total_actual_cents !== null
      ? recon.total_actual_cents - recon.total_estimated_cents
      : null;
  return (
    <div className="overflow-x-auto rounded-md border border-ink-700 bg-ink-850">
      <table className="w-full text-sm">
        <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-400">
          <tr>
            <th className="px-3 py-2">day</th>
            <th className="px-3 py-2">estimated</th>
            <th className="px-3 py-2">actual</th>
            <th className="px-3 py-2">delta</th>
          </tr>
        </thead>
        <tbody>
          {recon.days.map((d) => (
            <tr key={d.day} className="border-t border-ink-800">
              <td className="px-3 py-2 text-ink-100">{formatDay(d.day)}</td>
              <td className="px-3 py-2 text-ink-300">
                {formatCents(d.estimated_cents)}
              </td>
              <td className="px-3 py-2 text-ink-300">
                {d.actual_cents === null ? (
                  <span className="text-ink-500">not pulled</span>
                ) : (
                  formatCents(d.actual_cents)
                )}
              </td>
              <td className="px-3 py-2">
                {d.delta_cents === null ? (
                  <span className="text-ink-500">-</span>
                ) : (
                  <DeltaBadge cents={d.delta_cents} />
                )}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink-700 bg-ink-900/60">
            <td className="px-3 py-2 text-ink-100 font-semibold">total (7d)</td>
            <td className="px-3 py-2 text-ink-100 font-semibold">
              {formatCents(recon.total_estimated_cents)}
            </td>
            <td className="px-3 py-2 text-ink-100 font-semibold">
              {recon.total_actual_cents === null
                ? "-"
                : formatCents(recon.total_actual_cents)}
            </td>
            <td className="px-3 py-2">
              {totalDeltaCents === null ? (
                <span className="text-ink-500">-</span>
              ) : (
                <DeltaBadge cents={totalDeltaCents} />
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DeltaBadge({ cents }: { cents: number }) {
  const abs = Math.abs(cents);
  const tone =
    abs < 1
      ? "border-ink-700 bg-ink-800 text-ink-300"
      : cents > 0
        ? "border-red-700 bg-red-900/40 text-red-200"
        : "border-emerald-700 bg-emerald-900/40 text-emerald-200";
  const sign = cents > 0 ? "+" : cents < 0 ? "-" : "";
  return (
    <span className={`rounded border px-2 py-0.5 text-xs ${tone}`}>
      {sign}
      {formatCents(abs)}
    </span>
  );
}

function SurfaceCard({
  surface,
  calls,
  cents,
}: {
  surface: string;
  calls: number;
  cents: number;
}) {
  return (
    <div className="rounded-md border border-ink-700 bg-ink-850 p-4">
      <div className="flex items-center justify-between">
        <span
          className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${surfaceBadge(surface)}`}
        >
          {surface}
        </span>
        <span className="text-xs text-ink-400">{calls.toLocaleString()} calls</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-ink-50">
        {formatCents(cents)}
      </div>
    </div>
  );
}
