"use client";
// Compact inline-SVG chart primitives for the admin analytics dashboard.
// Deliberately small and framework-free (no Recharts, no re-using the big D3
// components in src/components/charts) so this bundle stays lean. Each chart
// is layout-agnostic — the caller sets the container size.
import type { DayPoint } from "./aggregations";

export const PALETTE = {
  emerald: "#0e9a73",
  blue: "#3b82f6",
  amber: "#f59e0b",
  purple: "#a855f7",
  rose: "#f43f5e",
  slate: "#64748b",
  gridLine: "#1f2937", // matches ink-800-ish for subtle grid
  axisLabel: "#94a3b8",
};

const W = 640;
const H = 200;
const M = { t: 8, r: 12, b: 20, l: 34 };
const innerW = W - M.l - M.r;
const innerH = H - M.t - M.b;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const stepped = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return stepped * mag;
}

function yTicks(max: number): number[] {
  return [0, max * 0.25, max * 0.5, max * 0.75, max];
}

function monthDay(day: string): string {
  // day is "YYYY-MM-DD"
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function xForIndex(i: number, n: number): number {
  if (n <= 1) return M.l;
  return M.l + (i / (n - 1)) * innerW;
}

function xForBar(i: number, n: number): { x: number; w: number } {
  const bw = n === 0 ? 0 : innerW / n;
  return { x: M.l + i * bw + bw * 0.15, w: bw * 0.7 };
}

// ----------------------------------------------------------------------------
// AxisLabels — shared between the charts.
// ----------------------------------------------------------------------------
function YAxis({ max }: { max: number }) {
  return (
    <g>
      {yTicks(max).map((v, i) => {
        const y = M.t + innerH - (v / max) * innerH;
        return (
          <g key={i}>
            <line
              x1={M.l}
              x2={M.l + innerW}
              y1={y}
              y2={y}
              stroke={PALETTE.gridLine}
              strokeDasharray="2 3"
              strokeWidth={1}
            />
            <text
              x={M.l - 6}
              y={y + 3}
              textAnchor="end"
              fontSize={10}
              fill={PALETTE.axisLabel}
            >
              {Math.round(v).toLocaleString()}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XAxis({ points }: { points: DayPoint[] }) {
  const n = points.length;
  const pick = n <= 6 ? points : [points[0], points[Math.floor(n / 2)], points[n - 1]];
  return (
    <g>
      {pick.map((p, i, arr) => {
        const idx = points.indexOf(p);
        const x = xForIndex(idx, n);
        return (
          <text
            key={i}
            x={x}
            y={H - 4}
            textAnchor={i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle"}
            fontSize={10}
            fill={PALETTE.axisLabel}
          >
            {monthDay(p.day)}
          </text>
        );
      })}
    </g>
  );
}

// ----------------------------------------------------------------------------
// AreaChart — single cumulative series with gradient fill.
// ----------------------------------------------------------------------------
export function AreaChart({
  data,
  color = PALETTE.emerald,
  title,
}: {
  data: DayPoint[];
  color?: string;
  title?: string;
}) {
  if (data.length === 0) return <EmptyChart label="No data" />;
  const max = niceMax(Math.max(1, ...data.map((d) => d.count)));
  const gradId = `grad-${Math.random().toString(36).slice(2, 8)}`;

  const linePath = data
    .map((d, i) => {
      const x = xForIndex(i, data.length);
      const y = M.t + innerH - (d.count / max) * innerH;
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  const areaPath =
    linePath +
    ` L${xForIndex(data.length - 1, data.length)},${M.t + innerH}` +
    ` L${xForIndex(0, data.length)},${M.t + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <YAxis max={max} />
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.75} />
      <XAxis points={data} />
    </svg>
  );
}

// ----------------------------------------------------------------------------
// BarChart — daily counts. Same axes as AreaChart.
// ----------------------------------------------------------------------------
export function BarChart({
  data,
  color = PALETTE.blue,
  title,
}: {
  data: DayPoint[];
  color?: string;
  title?: string;
}) {
  if (data.length === 0) return <EmptyChart label="No data" />;
  const max = niceMax(Math.max(1, ...data.map((d) => d.count)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
      <YAxis max={max} />
      {data.map((d, i) => {
        const { x, w } = xForBar(i, data.length);
        const h = (d.count / max) * innerH;
        const y = M.t + innerH - h;
        return (
          <rect key={i} x={x} y={y} width={w} height={h} fill={color} rx={1.5}>
            <title>{`${d.day}: ${d.count}`}</title>
          </rect>
        );
      })}
      <XAxis points={data} />
    </svg>
  );
}

// ----------------------------------------------------------------------------
// LineMulti — multiple series over a shared day axis. Used for the Daily
// Activity Mix chart on the Growth tab.
// ----------------------------------------------------------------------------
export type Series = { name: string; color: string; data: DayPoint[] };

export function LineMulti({ series, title }: { series: Series[]; title?: string }) {
  const anyData = series.some((s) => s.data.length > 0);
  if (!anyData) return <EmptyChart label="No data" />;
  // Use the first series' day axis; all should be aligned by the caller.
  const axis = series.find((s) => s.data.length > 0)!.data;
  const max = niceMax(
    Math.max(1, ...series.flatMap((s) => s.data.map((d) => d.count))),
  );

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        <YAxis max={max} />
        {series.map((s, si) => {
          if (s.data.length === 0) return null;
          const path = s.data
            .map((d, i) => {
              const x = xForIndex(i, axis.length);
              const y = M.t + innerH - (d.count / max) * innerH;
              return `${i === 0 ? "M" : "L"}${x},${y}`;
            })
            .join(" ");
          return <path key={si} d={path} fill="none" stroke={s.color} strokeWidth={1.6} />;
        })}
        <XAxis points={axis} />
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-300">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// HBar — horizontal bars for ranked lists (feature usage, top events).
// Scales height with item count so many rows stay readable.
// ----------------------------------------------------------------------------
export function HBarChart({
  items,
  color = PALETTE.emerald,
  maxRows,
  title,
}: {
  items: Array<{ label: string; value: number }>;
  color?: string;
  maxRows?: number;
  title?: string;
}) {
  const rows = maxRows ? items.slice(0, maxRows) : items;
  if (rows.length === 0) return <EmptyChart label="No data" />;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const rowH = 22;
  const svgH = Math.max(80, rows.length * rowH + 8);
  const labelW = 140;
  const barArea = W - labelW - 24;

  return (
    <svg viewBox={`0 0 ${W} ${svgH}`} className="w-full" role="img" aria-label={title}>
      {rows.map((r, i) => {
        const y = i * rowH;
        const w = (r.value / max) * barArea;
        return (
          <g key={`${r.label}-${i}`}>
            <text
              x={labelW - 8}
              y={y + rowH / 2 + 4}
              textAnchor="end"
              fontSize={11}
              fill={PALETTE.axisLabel}
            >
              {r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label}
            </text>
            <rect x={labelW} y={y + 4} width={w} height={rowH - 8} fill={color} rx={2}>
              <title>{`${r.label}: ${r.value}`}</title>
            </rect>
            <text
              x={labelW + w + 6}
              y={y + rowH / 2 + 4}
              fontSize={11}
              fill="#e2e8f0"
            >
              {r.value.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ----------------------------------------------------------------------------
// EmptyChart — neutral placeholder keeping the layout height stable.
// ----------------------------------------------------------------------------
export function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[180px] items-center justify-center text-xs text-ink-500">
      {label}
    </div>
  );
}
