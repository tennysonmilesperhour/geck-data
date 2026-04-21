"use client";
// Per-request audit log for /api/ingest. Each row is one POST: how many
// events arrived, how many landed, whether the request was authenticated,
// and (for the multipart path) how many files and of what kinds.
//
// Reads from public.ingest_audit (admin-only via RLS; see 0004 migration).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Panel } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import { fmtRelative } from "@/lib/format";

type Row = {
  id: string;
  received_at: string;
  source_tag: string | null;
  content_type: string | null;
  event_count: number;
  ok_count: number;
  failed_count: number;
  duration_ms: number | null;
  status_code: number | null;
  error_summary: string | null;
  event_types: string[] | null;
  file_count: number | null;
  client_ip_hash: string | null;
  user_agent: string | null;
};

const PERIOD_MS: Record<string, number | null> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 86400_000,
  "30d": 30 * 86400_000,
  all: null,
};
const PERIODS = Object.keys(PERIOD_MS);

export default function IngestAuditViewer() {
  const [rows, setRows] = useState<Row[]>([]);
  const [period, setPeriod] = useState<string>("24h");
  const [hideSuccess, setHideSuccess] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const supabase = createClient();
    let q = supabase
      .from("ingest_audit")
      .select(
        "id, received_at, source_tag, content_type, event_count, ok_count, failed_count, duration_ms, status_code, error_summary, event_types, file_count, client_ip_hash, user_agent",
      )
      .order("received_at", { ascending: false })
      .limit(500);
    const cutoff = PERIOD_MS[period];
    if (cutoff != null) {
      q = q.gte("received_at", new Date(Date.now() - cutoff).toISOString());
    }
    const { data, error } = await q;
    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }, [period]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (hideSuccess && r.status_code === 200 && r.failed_count === 0) return false;
      if (!q) return true;
      return (
        (r.source_tag ?? "").toLowerCase().includes(q) ||
        (r.error_summary ?? "").toLowerCase().includes(q) ||
        (r.user_agent ?? "").toLowerCase().includes(q) ||
        (r.event_types ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [rows, hideSuccess, query]);

  const kpis = useMemo(() => {
    const requests = rows.length;
    const totalEvents = rows.reduce((a, r) => a + (r.event_count ?? 0), 0);
    const ok = rows.reduce((a, r) => a + (r.ok_count ?? 0), 0);
    const failed = rows.reduce((a, r) => a + (r.failed_count ?? 0), 0);
    const errorResponses = rows.filter(
      (r) => (r.status_code ?? 500) >= 400,
    ).length;
    const avgDuration =
      rows.length === 0
        ? 0
        : Math.round(
            rows.reduce((a, r) => a + (r.duration_ms ?? 0), 0) / rows.length,
          );
    const okPct =
      totalEvents === 0 ? 100 : Math.round((ok / totalEvents) * 100);
    return { requests, totalEvents, ok, failed, errorResponses, avgDuration, okPct };
  }, [rows]);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Requests" value={kpis.requests.toLocaleString()} />
        <KpiCard
          label="Events"
          value={kpis.totalEvents.toLocaleString()}
          sub={`${kpis.ok.toLocaleString()} ok · ${kpis.failed.toLocaleString()} failed`}
          tone="info"
        />
        <KpiCard
          label="Event success"
          value={`${kpis.okPct}%`}
          tone={kpis.okPct >= 95 ? "positive" : kpis.okPct >= 80 ? "warn" : "negative"}
        />
        <KpiCard
          label="Error responses"
          value={kpis.errorResponses.toLocaleString()}
          tone={kpis.errorResponses === 0 ? "positive" : "negative"}
          sub="status ≥ 400"
        />
        <KpiCard
          label="Avg duration"
          value={`${kpis.avgDuration.toLocaleString()} ms`}
        />
      </section>

      <Panel
        title="Ingest audit"
        subtitle="One row per POST /api/ingest. Writes use the service role; the table cannot be polluted by anon callers."
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
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-300">
              <input
                type="checkbox"
                checked={hideSuccess}
                onChange={(e) => setHideSuccess(e.target.checked)}
                className="accent-claude"
              />
              Problems only
            </label>
            <input
              type="search"
              placeholder="Search source, event type, error…"
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
            0004_ingest_audit.sql migration.
          </p>
        ) : null}
        {filtered.length === 0 ? (
          <p className="text-sm text-ink-400">
            No matching rows. {loading ? "Still loading…" : "Nothing is hitting /api/ingest in this window."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-ink-400">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2 text-right">Events</th>
                  <th className="px-3 py-2 text-right">OK / Failed</th>
                  <th className="px-3 py-2 text-right">Duration</th>
                  <th className="px-3 py-2">Event types / error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/60">
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className="cursor-pointer hover:bg-ink-850"
                  >
                    <td className="px-3 py-1.5 font-mono text-[11px] text-ink-200">
                      {fmtRelative(r.received_at)}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge code={r.status_code} />
                    </td>
                    <td className="px-3 py-1.5 text-xs text-ink-300">
                      {kindOf(r)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">
                      {(r.event_count ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">
                      <span className="text-ready">{r.ok_count}</span>
                      <span className="text-ink-500"> / </span>
                      <span className={r.failed_count > 0 ? "text-danger" : "text-ink-400"}>
                        {r.failed_count}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs text-ink-300">
                      {r.duration_ms != null ? `${r.duration_ms} ms` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      {r.error_summary ? (
                        <span className="text-danger">{r.error_summary}</span>
                      ) : (
                        <span className="font-mono text-[11px] text-ink-400">
                          {(r.event_types ?? []).slice(0, 4).join(", ")}
                          {r.event_types && r.event_types.length > 4
                            ? ` +${r.event_types.length - 4}`
                            : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected ? (
        <IngestDetailDialog row={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function StatusBadge({ code }: { code: number | null }) {
  const c = code ?? 0;
  const tone =
    c >= 200 && c < 300
      ? "border-ready/40 bg-ready/10 text-ready"
      : c === 401 || c === 403
      ? "border-busy/40 bg-busy/10 text-busy"
      : c >= 400
      ? "border-danger/40 bg-danger/10 text-danger"
      : "border-ink-700 bg-ink-850 text-ink-300";
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${tone}`}>
      {c || "?"}
    </span>
  );
}

function kindOf(r: Row): string {
  if ((r.content_type ?? "").includes("multipart")) {
    return `multipart · ${r.file_count ?? 0} file${r.file_count === 1 ? "" : "s"}`;
  }
  if ((r.content_type ?? "").includes("json")) return "json events";
  return r.content_type ?? "unknown";
}

function IngestDetailDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-ink-700/70 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusBadge code={row.status_code} />
              <span className="font-mono text-[11px] text-ink-400">
                {fmtRelative(row.received_at)}
              </span>
              <span className="text-ink-500">·</span>
              <span className="text-xs text-ink-300">{kindOf(row)}</span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-ink-300">
              {row.event_count} events · {row.ok_count} ok ·{" "}
              <span className={row.failed_count > 0 ? "text-danger" : undefined}>
                {row.failed_count} failed
              </span>
              {row.duration_ms != null ? ` · ${row.duration_ms} ms` : ""}
            </p>
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
          <Field label="Source tag" value={row.source_tag ?? "(none)"} />
          <Field label="Client IP hash" value={row.client_ip_hash ?? "(none)"} mono />
          <Field label="User agent" value={row.user_agent} mono />
          <Field
            label="Event types"
            value={row.event_types?.length ? row.event_types.join(", ") : "(none)"}
            mono
          />
          {row.error_summary ? (
            <section>
              <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-danger">
                Error summary
              </h3>
              <pre className="whitespace-pre-wrap rounded border border-danger/30 bg-danger/5 p-2 text-[11px] text-danger">
                {row.error_summary}
              </pre>
            </section>
          ) : null}
        </div>
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
