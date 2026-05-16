"use client";
// Inline-SVG stacked bars — one column per month, segments colored per
// combo. Shared legend underneath. No external chart lib; keeps the
// bundle lean.
import type { SupplyMonth } from "@/lib/market/widget-types";

const W = 880;
const H = 280;
const M = { t: 16, r: 16, b: 72, l: 44 };
const innerW = W - M.l - M.r;
const innerH = H - M.t - M.b;

export default function SupplyStackedBars({ months }: { months: SupplyMonth[] }) {
  if (months.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-xs text-forest-500">
        No pipeline data
      </div>
    );
  }
  const maxTotal = Math.max(...months.map((m) => m.total), 1);
  const barW = (innerW / months.length) * 0.68;
  const step = innerW / months.length;

  // Legend is assembled from the first month — every month carries the
  // same combo order by construction.
  const legend = months[0]!.perCombo.map((c) => ({ combo: c.combo, color: c.color }));

  const yTicks = 4;
  const yFor = (v: number) => M.t + innerH - (v / maxTotal) * innerH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected hatchlings">
      {/* Y grid */}
      {Array.from({ length: yTicks + 1 }).map((_, i) => {
        const v = (i / yTicks) * maxTotal;
        return (
          <g key={i}>
            <line
              x1={M.l}
              x2={M.l + innerW}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="#1a3326"
              strokeDasharray="2 3"
              strokeWidth={1}
            />
            <text
              x={M.l - 6}
              y={yFor(v) + 3}
              textAnchor="end"
              fontSize={10}
              fill="#8ca395"
            >
              {Math.round(v)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {months.map((month, i) => {
        const x = M.l + i * step + (step - barW) / 2;
        let y = M.t + innerH;
        return (
          <g key={month.monthLabel}>
            {month.perCombo.map((seg) => {
              const h = maxTotal === 0 ? 0 : (seg.n / maxTotal) * innerH;
              y -= h;
              return h > 0 ? (
                <rect
                  key={seg.combo}
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  fill={seg.color}
                  rx={1}
                >
                  <title>{`${month.monthLabel} · ${seg.combo}: ${seg.n}`}</title>
                </rect>
              ) : null;
            })}
            <text
              x={x + barW / 2}
              y={H - 54}
              textAnchor="middle"
              fontSize={10}
              fill="#8ca395"
            >
              {month.monthLabel}
            </text>
          </g>
        );
      })}

      {/* Legend — up to 2 rows under the axis */}
      <g transform={`translate(${M.l}, ${H - 36})`} fontSize={10}>
        {legend.map((l, i) => {
          const col = i % 6;
          const row = Math.floor(i / 6);
          return (
            <g key={l.combo} transform={`translate(${col * 140}, ${row * 16})`}>
              <rect width={10} height={10} fill={l.color} rx={1.5} />
              <text x={14} y={9} fill="#c9dad1">
                {l.combo}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
