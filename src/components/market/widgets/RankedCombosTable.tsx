"use client";
// Left-side table on the Combos tab. Each row is clickable and highlights
// when selected so the right-hand detail panel reflects the choice.
// Sort metric is a dropdown in the header (Volume / Median sold / Ask /
// Spread / Days). Column headers are also click-to-sort for consistency.
import ConfidenceBadge from "@/components/market/ConfidenceBadge";
import LivePreviewTag, {
  type LivePreviewStatus,
} from "@/components/market/LivePreviewTag";
import type { ComboRow, ComboRankSort } from "@/lib/market/fixtures";

export default function RankedCombosTable({
  rows,
  sort,
  onSortChange,
  selected,
  onSelect,
  status,
  note,
}: {
  rows: ComboRow[];
  sort: ComboRankSort;
  onSortChange: (s: ComboRankSort) => void;
  selected: string | null;
  onSelect: (combo: string) => void;
  status?: LivePreviewStatus;
  note?: string;
}) {
  return (
    <section className="forest-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-forest-700/70 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
          >
            ◆
          </span>
          <div>
            <h2 className="text-base font-semibold text-forest-50">
              Trait Combinations — ranked
            </h2>
            <p className="mt-0.5 max-w-xs text-xs text-forest-400">
              The market prices combinations, not single traits. Click a row
              to drill in.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status ? <LivePreviewTag status={status} note={note} /> : null}
          <label className="sr-only">Sort by</label>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as ComboRankSort)}
            className="rounded-md border border-forest-700 bg-forest-950/60 px-2 py-1 text-xs text-forest-200"
          >
            <option value="volume">Volume (sold)</option>
            <option value="medianSold">Median sold</option>
            <option value="ask">Ask</option>
            <option value="spread">Spread</option>
            <option value="days">Days to sell</option>
          </select>
          <span aria-hidden className="text-xs text-forest-500">
            ↧
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-forest-700 bg-forest-950/40 px-2 py-1 text-[10px] text-forest-300 hover:text-forest-100"
            title="Methodology (coming soon)"
          >
            <span aria-hidden>ⓘ</span>
            Methodology
          </button>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-ready">
              <Th>Combo</Th>
              <ThNum sort="medianSold" current={sort} onClick={onSortChange}>
                Median sold
              </ThNum>
              <ThNum sort="ask" current={sort} onClick={onSortChange}>
                Ask
              </ThNum>
              <ThNum sort="spread" current={sort} onClick={onSortChange}>
                Spread
              </ThNum>
              <ThNum sort="days" current={sort} onClick={onSortChange}>
                Days
              </ThNum>
              <ThNum sort="volume" current={sort} onClick={onSortChange}>
                Vol
              </ThNum>
              <Th className="text-right">Conf</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forest-700/60">
            {rows.map((r) => {
              const active = r.combo === selected;
              return (
                <tr
                  key={r.combo}
                  onClick={() => onSelect(r.combo)}
                  className={`cursor-pointer transition ${
                    active ? "bg-ready/10" : "hover:bg-forest-850/60"
                  }`}
                >
                  <td className="px-3 py-3 align-top">
                    <div className="font-medium text-forest-50">{r.combo}</div>
                    <div className="font-mono text-[10px] text-forest-500">
                      {r.traits[0]} · {r.traits[1]}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top font-mono">
                    <div className="tabular-nums text-ready">
                      ${r.medianSold.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-forest-500">
                      ±${r.stddev.toLocaleString()}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right align-top font-mono tabular-nums text-forest-100">
                    ${r.ask.toLocaleString()}
                  </td>
                  <td
                    className={`px-3 py-3 text-right align-top font-mono tabular-nums ${spreadTone(
                      r.spreadPct,
                    )}`}
                  >
                    {r.spreadPct >= 0 ? "" : ""}
                    {r.spreadPct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-3 text-right align-top font-mono tabular-nums text-forest-200">
                    {r.daysToSell}d
                  </td>
                  <td className="px-3 py-3 text-right align-top font-mono tabular-nums text-forest-200">
                    {r.volume}
                  </td>
                  <td className="px-3 py-3 text-right align-top">
                    <ConfidenceBadge score={r.attribution.confidence.score} size="sm" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 ${className}`}>{children}</th>;
}

function ThNum({
  children,
  sort,
  current,
  onClick,
}: {
  children: React.ReactNode;
  sort: ComboRankSort;
  current: ComboRankSort;
  onClick: (s: ComboRankSort) => void;
}) {
  const active = sort === current;
  return (
    <th className="px-3 py-2 text-right">
      <button
        type="button"
        onClick={() => onClick(sort)}
        className={`inline-flex items-center gap-1 hover:text-forest-100 ${
          active ? "text-ready" : "text-ready/70"
        }`}
      >
        {children}
        {active ? <span aria-hidden>▾</span> : null}
      </button>
    </th>
  );
}

function spreadTone(pct: number): string {
  if (Math.abs(pct) < 5) return "text-ready";
  if (Math.abs(pct) < 15) return "text-busy";
  return "text-danger";
}
