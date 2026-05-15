// Morph ID eval dashboard. Persisted runs of recognize-gecko-morph
// against geck-data's wild test split, charted over time so you can see
// whether prompt tweaks / model upgrades / few-shot bank growth move
// the needle.

import Link from "next/link";
import { getEvalRuns, type EvalRun } from "@/lib/training/evalRuns";
import AccuracyLine from "@/components/landing/AccuracyLine";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default async function EvalsPage() {
  const runs = await getEvalRuns(50);
  const latest = runs.find((r) => r.status === "success") ?? null;
  const successRuns = runs.filter((r) => r.status === "success");
  const previous = successRuns[1] ?? null;

  const delta =
    latest?.primary_morph_top1_accuracy != null &&
    previous?.primary_morph_top1_accuracy != null
      ? latest.primary_morph_top1_accuracy - previous.primary_morph_top1_accuracy
      : null;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
            Eval
          </div>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink-50">
            Morph ID accuracy over time
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-300">
            Each run is a call to{" "}
            <code className="text-ink-100">recognize-gecko-morph</code>{" "}
            over geck-data&apos;s test split, comparing the tool&apos;s
            output to seller-reported labels mapped to canonical ids.
            Watch the delta as the verified training set grows.
          </p>
        </div>
        <Link
          href="/data-admin/training"
          className="rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-300 hover:text-ink-100"
        >
          ← Training overview
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Latest top-1 accuracy"
          value={pct(latest?.primary_morph_top1_accuracy)}
          sub={latest ? `n = ${fmtInt(latest.eval_set_size)}` : ""}
          deltaLabel={
            delta == null
              ? null
              : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp vs prev`
          }
          deltaTone={delta == null ? "neutral" : delta >= 0 ? "positive" : "negative"}
        />
        <KpiTile
          label="Genetic Jaccard"
          value={pct(latest?.genetic_jaccard_avg)}
          sub="Avg over images"
        />
        <KpiTile
          label="Base color accuracy"
          value={pct(latest?.base_color_accuracy)}
          sub="When seller labeled"
        />
        <KpiTile
          label="Total runs"
          value={fmtInt(runs.length)}
          sub={`${fmtInt(successRuns.length)} successful`}
        />
      </section>

      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
          Top-1 accuracy trend
        </h3>
        <AccuracyLine runs={runs} />
      </section>

      {latest?.top_confusions && latest.top_confusions.length > 0 && (
        <section>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
            Latest run · top confusions
          </h3>
          <div className="overflow-hidden rounded-xl border border-ink-700">
            <table className="w-full text-sm">
              <thead className="bg-ink-900 text-left font-mono text-[10px] uppercase tracking-wider text-ink-400">
                <tr>
                  <th className="px-3 py-2">Ground truth</th>
                  <th className="px-3 py-2">Tool predicted</th>
                  <th className="px-3 py-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/60">
                {latest.top_confusions.map((c, i) => (
                  <tr key={`${c.label}-${c.predicted}-${i}`} className="hover:bg-ink-850">
                    <td className="px-3 py-2 font-mono text-ink-100">{c.label}</td>
                    <td className="px-3 py-2 font-mono text-amber-300">{c.predicted}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {latest && Object.keys(latest.per_trait_metrics ?? {}).length > 0 && (
        <section>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
            Latest run · per-trait F1
          </h3>
          <PerTraitTable metrics={latest.per_trait_metrics} />
        </section>
      )}

      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
          Run history
        </h3>
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-left font-mono text-[10px] uppercase tracking-wider text-ink-400">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2 text-right">N</th>
                <th className="px-3 py-2 text-right">Top-1</th>
                <th className="px-3 py-2 text-right">Genetic</th>
                <th className="px-3 py-2 text-right">Base color</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/60">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-ink-400">
                    No runs yet. From the repo: run{" "}
                    <code className="text-ink-100">
                      python scripts/eval_morph_id.py --limit 100
                    </code>
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="hover:bg-ink-850">
                    <td className="px-3 py-2 text-ink-300" title={r.started_at}>
                      {timeAgo(r.started_at)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-300">
                      {r.model ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtInt(r.eval_set_size)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {pct(r.primary_morph_top1_accuracy)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {pct(r.genetic_jaccard_avg)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {pct(r.base_color_accuracy)}
                    </td>
                    <td className="px-3 py-2 max-w-xs truncate text-xs text-ink-400" title={r.notes ?? ""}>
                      {r.notes ?? (r.error_message ? `! ${r.error_message}` : "")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: EvalRun["status"] }) {
  const cls =
    status === "success"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
      : status === "running"
        ? "bg-sky-500/15 text-sky-300 border-sky-500/40"
        : "bg-rose-500/15 text-rose-300 border-rose-500/40";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}
    >
      {status}
    </span>
  );
}

function KpiTile({
  label,
  value,
  sub,
  deltaLabel,
  deltaTone,
}: {
  label: string;
  value: string;
  sub?: string;
  deltaLabel?: string | null;
  deltaTone?: "positive" | "negative" | "neutral";
}) {
  const deltaCls =
    deltaTone === "positive"
      ? "text-emerald-300"
      : deltaTone === "negative"
        ? "text-rose-300"
        : "text-ink-400";
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-ink-50">
        {value}
      </div>
      {deltaLabel && (
        <div className={`mt-0.5 font-mono text-[10px] ${deltaCls}`}>{deltaLabel}</div>
      )}
      {sub && <div className="mt-1 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

function PerTraitTable({
  metrics,
}: {
  metrics: Record<string, { precision: number; recall: number; f1: number; support: number; predicted: number }>;
}) {
  const rows = Object.entries(metrics)
    .map(([trait, m]) => ({ trait, ...m }))
    .filter((r) => r.support >= 3) // hide single-example rows; noisy
    .sort((a, b) => b.support - a.support);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink-700 p-3 text-xs text-ink-500">
        Not enough per-trait support yet. Increase --limit on the next run.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-ink-700">
      <table className="w-full text-sm">
        <thead className="bg-ink-900 text-left font-mono text-[10px] uppercase tracking-wider text-ink-400">
          <tr>
            <th className="px-3 py-2">Trait</th>
            <th className="px-3 py-2 text-right">Support</th>
            <th className="px-3 py-2 text-right">Precision</th>
            <th className="px-3 py-2 text-right">Recall</th>
            <th className="px-3 py-2 text-right">F1</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-700/60">
          {rows.map((r) => (
            <tr key={r.trait} className="hover:bg-ink-850">
              <td className="px-3 py-2 font-mono text-ink-100">{r.trait}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.support}</td>
              <td className="px-3 py-2 text-right tabular-nums">{(r.precision * 100).toFixed(1)}%</td>
              <td className="px-3 py-2 text-right tabular-nums">{(r.recall * 100).toFixed(1)}%</td>
              <td className="px-3 py-2 text-right tabular-nums">
                <span
                  className={
                    r.f1 >= 0.7
                      ? "text-emerald-300"
                      : r.f1 >= 0.4
                        ? "text-amber-300"
                        : "text-rose-300"
                  }
                >
                  {(r.f1 * 100).toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
