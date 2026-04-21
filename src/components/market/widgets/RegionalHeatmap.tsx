"use client";
// Combo × region heatmap. Renders one cell per combo/region pair.
//
//   - Hue encodes value (green low → yellow mid → red high) relative to the
//     grid's own [lo, hi] range — so weak supply regions aren't washed out
//     by one hot outlier.
//   - Opacity encodes confidence (0.25..1.0) so sparse cells fade back.
//   - Null cells render as "—" with a muted background so the reader can
//     tell "we have no data" from "price is low".
import type {
  HeatmapMetric,
  RegionalHeatmap as HeatmapData,
  RegionKey,
} from "@/lib/market/fixtures";
import { REGION_COLUMNS, heatmapMetricLabel } from "@/lib/market/fixtures";

export default function RegionalHeatmap({
  data,
  metric,
  onMetricChange,
  selected,
  onSelect,
}: {
  data: HeatmapData;
  metric: HeatmapMetric;
  onMetricChange: (m: HeatmapMetric) => void;
  selected: { combo: string; region: RegionKey } | null;
  onSelect: (sel: { combo: string; region: RegionKey } | null) => void;
}) {
  const [lo, hi] = data.range;

  return (
    <section className="forest-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-forest-700/70 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
          >
            ⬢
          </span>
          <div>
            <h2 className="text-base font-semibold text-forest-50">
              Regional heatmap — combo × market
            </h2>
            <p className="mt-0.5 max-w-sm text-xs text-forest-400">
              Where each combination commands premiums and where supply is thin
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={metric}
            onChange={(e) => onMetricChange(e.target.value as HeatmapMetric)}
            className="rounded-md border border-forest-700 bg-forest-950/60 px-2 py-1 text-xs text-forest-200"
          >
            <option value="medianSold">Median sold</option>
            <option value="ask">Ask</option>
            <option value="spread">Ask→Sold spread</option>
          </select>
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

      <div className="overflow-x-auto p-4">
        <table className="w-full min-w-[640px] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-ready">
              <th className="px-3 pb-2">Combo</th>
              {REGION_COLUMNS.map((r) => (
                <th key={r} className="px-2 pb-2 text-center">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.combo}>
                <td className="whitespace-nowrap px-3 text-sm text-forest-100">
                  {row.combo}
                </td>
                {REGION_COLUMNS.map((r) => {
                  const cell = row.cells[r];
                  const isSelected =
                    selected && selected.combo === row.combo && selected.region === r;
                  return (
                    <td key={r} className="px-1">
                      <Cell
                        cell={cell}
                        lo={lo}
                        hi={hi}
                        metric={metric}
                        selected={!!isSelected}
                        onClick={() =>
                          onSelect(
                            isSelected ? null : { combo: row.combo, region: r },
                          )
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-forest-700/70 p-4 text-[11px] text-forest-400">
        <div className="flex items-center gap-3">
          <Legend />
          <span className="text-forest-500">· opacity = confidence</span>
        </div>
        <span className="font-mono text-forest-300">
          {heatmapMetricLabel(metric)} range {formatByMetric(lo, metric)}–
          {formatByMetric(hi, metric)}
        </span>
      </footer>
    </section>
  );
}

function Cell({
  cell,
  lo,
  hi,
  metric,
  selected,
  onClick,
}: {
  cell: ReturnType<() => HeatmapData["rows"][number]["cells"][RegionKey]>;
  lo: number;
  hi: number;
  metric: HeatmapMetric;
  selected: boolean;
  onClick: () => void;
}) {
  if (!cell) {
    return (
      <div
        className="flex h-10 min-w-[52px] items-center justify-center rounded-md border border-forest-700 bg-forest-950/60 font-mono text-xs text-forest-500"
        title="No data"
      >
        —
      </div>
    );
  }

  const t = hi === lo ? 0.5 : (cell.value - lo) / (hi - lo);
  const bg = valueGradient(t, cell.confidence);
  const ring = selected
    ? "ring-2 ring-ready ring-offset-1 ring-offset-forest-900"
    : "";

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${formatByMetric(cell.value, metric)} · n=${cell.n} · conf ${Math.round(cell.confidence * 100)}`}
      className={`flex h-10 min-w-[52px] items-center justify-center rounded-md border border-forest-700 px-2 font-mono text-[11px] text-forest-50 transition hover:brightness-110 ${ring}`}
      style={{ backgroundColor: bg }}
    >
      {formatByMetric(cell.value, metric)}
    </button>
  );
}

// Maps 0..1 through a green → yellow → red gradient; returns rgba with the
// given alpha (confidence).
function valueGradient(t: number, alpha: number): string {
  // Clamp.
  const x = Math.max(0, Math.min(1, t));
  // Two-leg interpolation in RGB space.
  const mid = { r: 234, g: 179, b: 8 };   // yellow-500
  const lowC = { r: 16, g: 185, b: 129 }; // emerald-500
  const highC = { r: 244, g: 63, b: 94 }; // rose-500
  const [from, to, k] =
    x < 0.5
      ? [lowC, mid, x / 0.5]
      : [mid, highC, (x - 0.5) / 0.5];
  const r = Math.round(from.r + (to.r - from.r) * k);
  const g = Math.round(from.g + (to.g - from.g) * k);
  const b = Math.round(from.b + (to.b - from.b) * k);
  // Don't let ultra-low-confidence cells vanish entirely.
  const a = Math.max(0.18, Math.min(1, alpha));
  return `rgba(${r},${g},${b},${a})`;
}

function formatByMetric(v: number, m: HeatmapMetric): string {
  if (m === "spread") return `${v >= 0 ? "" : ""}${v.toFixed(1)}%`;
  return `$${Math.round(v).toLocaleString()}`;
}

function Legend() {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-forest-400">Scale:</span>
      <span className="inline-flex overflow-hidden rounded-md border border-forest-700">
        {stops.map((t) => (
          <span
            key={t}
            className="h-4 w-6"
            style={{ backgroundColor: valueGradient(t, 1) }}
          />
        ))}
      </span>
      <span className="text-forest-400">low · mid · high</span>
    </span>
  );
}
