"use client";
// Full CRUD-ish viewer over public.error_logs. Fed by reportError(), the
// React ErrorBoundary, and installGlobalErrorHandlers() (window.error +
// unhandledrejection).
//
// Layout matches the source app: KPI strip at top, filter/search row,
// list with level badges, click-to-expand detail dialog with mark-resolved
// + delete actions.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Panel, StatusPill } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import { fmtRelative } from "@/lib/format";

type ErrorRow = {
  id: string;
  level: "error" | "warning" | "info";
  message: string;
  stack: string | null;
  url: string | null;
  user_email: string | null;
  user_agent: string | null;
  source: string | null;
  context: Record<string, unknown> | null;
  resolved: boolean;
  resolved_date: string | null;
  created_date: string;
};

const PERIOD_MAP: Record<string, number | null> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 86400_000,
  "30d": 30 * 86400_000,
  all: null,
};
type PeriodKey = keyof typeof PERIOD_MAP;
const PERIODS: PeriodKey[] = ["24h", "7d", "30d", "all"];

type LevelFilter = "all" | "error" | "warning" | "info";

export default function ErrorLogsViewer() {
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [hideResolved, setHideResolved] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ErrorRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const supabase = createClient();
    let q = supabase
      .from("error_logs")
      .select(
        "id, level, message, stack, url, user_email, user_agent, source, context, resolved, resolved_date, created_date",
      )
      .order("created_date", { ascending: false })
      .limit(500);
    const cutoff = PERIOD_MAP[period];
    if (cutoff != null) {
      q = q.gte("created_date", new Date(Date.now() - cutoff).toISOString());
    }
    const { data, error } = await q;
    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as ErrorRow[]);
    }
    setLoading(false);
  }, [period]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (level !== "all" && r.level !== level) return false;
      if (hideResolved && r.resolved) return false;
      if (!q) return true;
      return (
        r.message.toLowerCase().includes(q) ||
        (r.url ?? "").toLowerCase().includes(q) ||
        (r.user_email ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, level, hideResolved, query]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const unresolved = rows.filter((r) => !r.resolved).length;
    const errors = rows.filter((r) => r.level === "error").length;
    const warnings = rows.filter((r) => r.level === "warning").length;
    const affected = new Set(
      rows.map((r) => r.user_email).filter((x): x is string => !!x),
    ).size;
    return { total, unresolved, errors, warnings, affected };
  }, [rows]);

  async function markResolved(row: ErrorRow, resolved: boolean): Promise<void> {
    const supabase = createClient();
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("error_logs")
      .update({
        resolved,
        resolved_by: resolved ? userRes.user?.id ?? null : null,
        resolved_date: resolved ? new Date().toISOString() : null,
      })
      .eq("id", row.id);
    if (error) {
      setErr(error.message);
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, resolved, resolved_date: resolved ? new Date().toISOString() : null } : r,
      ),
    );
    setSelected((s) => (s?.id === row.id ? { ...s, resolved } : s));
  }

  async function deleteRow(row: ErrorRow): Promise<void> {
    const ok = window.confirm("Delete this error row? This cannot be undone.");
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase.from("error_logs").delete().eq("id", row.id);
    if (error) {
      setErr(error.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    setSelected((s) => (s?.id === row.id ? null : s));
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Total" value={kpis.total.toLocaleString()} />
        <KpiCard label="Unresolved" value={kpis.unresolved.toLocaleString()} tone="warn" />
        <KpiCard label="Errors" value={kpis.errors.toLocaleString()} tone="negative" />
        <KpiCard label="Warnings" value={kpis.warnings.toLocaleString()} tone="warn" />
        <KpiCard label="Affected users" value={kpis.affected.toLocaleString()} tone="info" />
      </section>

      <Panel
        title="Error log"
        subtitle="Three pipelines feed this table: React ErrorBoundary, window.error, and unhandledrejection."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-ink-700 bg-ink-850 font-mono text-[11px]">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`px-2 py-1 ${
                    p === period ? "bg-ink-700 text-ink-50" : "text-ink-300 hover:bg-ink-800"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as LevelFilter)}
              className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-200"
            >
              <option value="all">All levels</option>
              <option value="error">Errors</option>
              <option value="warning">Warnings</option>
              <option value="info">Info</option>
            </select>
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-300">
              <input
                type="checkbox"
                checked={hideResolved}
                onChange={(e) => setHideResolved(e.target.checked)}
                className="accent-claude"
              />
              Hide resolved
            </label>
            <input
              type="search"
              placeholder="Search message, url, email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-48 rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-200 placeholder:text-ink-500"
            />
            <button
              type="button"
              onClick={() => void fetchRows()}
              disabled={loading}
              className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-200 hover:border-ink-600 disabled:opacity-50"
            >
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        }
      >
        {err ? (
          <p className="mb-3 text-xs text-danger">
            {err}. If this reads &quot;relation does not exist&quot;, run the
            0003_admin_analytics.sql migration.
          </p>
        ) : null}
        {filtered.length === 0 ? (
          <p className="text-sm text-ink-400">
            No matching error rows. {loading ? "Still loading…" : "Your users are (probably) fine."}
          </p>
        ) : (
          <ul className="divide-y divide-ink-700/60">
            {filtered.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-2 py-2 text-left hover:bg-ink-850"
                >
                  <LevelBadge level={r.level} />
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-ink-100">
                      {r.message}
                      {r.resolved ? (
                        <span className="ml-2 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
                          resolved
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-500">
                      {r.user_email ?? "anonymous"} · {r.url ?? "no-url"} · {fmtRelative(r.created_date)}
                    </div>
                  </div>
                  <span className="text-ink-500">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {selected ? (
        <ErrorDetailDialog
          row={selected}
          onClose={() => setSelected(null)}
          onToggleResolved={() => void markResolved(selected, !selected.resolved)}
          onDelete={() => void deleteRow(selected)}
        />
      ) : null}
    </div>
  );
}

function LevelBadge({ level }: { level: ErrorRow["level"] }) {
  const tone =
    level === "error"
      ? { status: "idle" as const, label: "error", cls: "text-danger border-danger/40 bg-danger/10" }
      : level === "warning"
      ? { status: "busy" as const, label: "warn", cls: "text-busy border-busy/40 bg-busy/10" }
      : { status: "info" as const, label: "info", cls: "text-info border-info/40 bg-info/10" };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tone.cls}`}
    >
      {tone.label}
    </span>
  );
}

function ErrorDetailDialog({
  row,
  onClose,
  onToggleResolved,
  onDelete,
}: {
  row: ErrorRow;
  onClose: () => void;
  onToggleResolved: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-ink-700/70 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <LevelBadge level={row.level} />
              <StatusPill
                status={row.resolved ? "ready" : "busy"}
                label={row.resolved ? "resolved" : "open"}
              />
              <span className="font-mono text-[11px] text-ink-400">
                {fmtRelative(row.created_date)}
              </span>
            </div>
            <p className="mt-2 break-words text-sm text-ink-100">{row.message}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-200 hover:border-ink-600"
          >
            Close
          </button>
        </header>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto p-4 text-xs">
          {row.stack ? (
            <section>
              <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Stack
              </h3>
              <pre className="max-h-60 overflow-auto rounded border border-ink-700 bg-ink-850 p-2 text-[11px] text-ink-200">
                {row.stack}
              </pre>
            </section>
          ) : null}
          <Field label="URL" value={row.url} mono />
          <Field label="User" value={row.user_email ?? "anonymous"} />
          <Field label="Source" value={row.source ?? "(untagged)"} />
          <Field label="User agent" value={row.user_agent} mono />
          {row.context && Object.keys(row.context).length > 0 ? (
            <section>
              <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Context
              </h3>
              <pre className="rounded border border-ink-700 bg-ink-850 p-2 text-[11px] text-ink-200">
                {JSON.stringify(row.context, null, 2)}
              </pre>
            </section>
          ) : null}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-ink-700/70 px-4 py-3">
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger hover:border-danger/60"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onToggleResolved}
            className="rounded-md bg-claude px-3 py-1.5 text-xs text-ink-50 shadow-glow hover:bg-claude-glow"
          >
            {row.resolved ? "Mark unresolved" : "Mark resolved"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <section>
      <h3 className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
        {label}
      </h3>
      <p className={`break-words text-ink-200 ${mono ? "font-mono text-[11px]" : ""}`}>
        {value}
      </p>
    </section>
  );
}
