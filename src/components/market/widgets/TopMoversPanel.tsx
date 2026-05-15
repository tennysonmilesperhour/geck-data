"use client";
// Two-column Top Movers card (APPRECIATING / DEPRECIATING). Each row:
//   [ combo name + sample size/avg ]   [ sparkline ]   [ % delta + arrow ]
//
// Matches the handoff screenshots. Row click is reserved for task 4
// (Combos tab detail drill-in) — placeholder handler for now.
import { Sparkline } from "@/components/market/charts/InlineCharts";
import LivePreviewTag, {
  type LivePreviewStatus,
} from "@/components/market/LivePreviewTag";
import type { Mover } from "@/lib/market/fixtures";

export default function TopMoversPanel({
  appreciating,
  depreciating,
  onSelectCombo,
  status,
  note,
}: {
  appreciating: Mover[];
  depreciating: Mover[];
  onSelectCombo?: (combo: string) => void;
  status?: LivePreviewStatus;
  note?: string;
}) {
  return (
    <section className="forest-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
          >
            ⇅
          </span>
          <div>
            <h2 className="font-display text-[18px] font-medium tracking-tight text-forest-50">Top Movers</h2>
            <p className="mt-0.5 text-xs text-forest-400">
              Largest price swings in the selected timeframe
            </p>
          </div>
        </div>
        {status ? <LivePreviewTag status={status} note={note} /> : null}
      </header>

      <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Column
          title="Appreciating"
          arrow="↗"
          tone="positive"
          rows={appreciating}
          onSelect={onSelectCombo}
        />
        <Column
          title="Depreciating"
          arrow="↘"
          tone="negative"
          rows={depreciating}
          onSelect={onSelectCombo}
        />
      </div>
    </section>
  );
}

function Column({
  title,
  arrow,
  tone,
  rows,
  onSelect,
}: {
  title: string;
  arrow: string;
  tone: "positive" | "negative";
  rows: Mover[];
  onSelect?: (combo: string) => void;
}) {
  const color = tone === "positive" ? "text-ready" : "text-danger";
  return (
    <div>
      <div className={`mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${color}`}>
        <span aria-hidden>{arrow}</span>
        <span>{title}</span>
      </div>
      <ul className="divide-y divide-forest-700/60">
        {rows.length === 0 ? (
          <li className="py-3 text-xs text-forest-500">No movers yet.</li>
        ) : (
          rows.map((m) => (
            <li
              key={m.combo}
              className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2.5 ${
                onSelect ? "cursor-pointer transition hover:bg-forest-850/50" : ""
              }`}
              onClick={onSelect ? () => onSelect(m.combo) : undefined}
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-forest-100">{m.combo}</div>
                <div className="font-mono text-[10px] text-forest-500">
                  ${m.avgPrice.toLocaleString()} avg · n={m.n}
                </div>
              </div>
              <Sparkline values={m.spark} />
              <div className={`flex items-center gap-1 font-mono text-sm ${color}`}>
                <span aria-hidden>{tone === "positive" ? "▲" : "▼"}</span>
                <span className="tabular-nums">
                  {Math.abs(m.deltaPct).toFixed(1)}%
                </span>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
