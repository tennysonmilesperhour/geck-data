"use client";
// Multi-series line chart for the Combos detail panel. Matches the
// screenshot: dotted bands + solid sold line + dashed ask + solid
// internal/external avg. Single legend below the axes.
import { useMemo } from "react";
import type { MultiSeries } from "@/lib/market/widget-types";

const W = 720;
const H = 280;
const M = { t: 10, r: 16, b: 44, l: 48 };
const innerW = W - M.l - M.r;
const innerH = H - M.t - M.b;

export default function MultiLineChart({ series }: { series: MultiSeries[] }) {
  const all = series.flatMap((s) => s.points.map((p) => p.v));
  const hasData = all.length > 0;

  const { lo, hi, paths, xLabels } = useMemo(() => {
    if (!hasData) return { lo: 0, hi: 1, paths: [] as string[], xLabels: [] as string[] };
    const lo = Math.max(0, Math.min(...all) * 0.8);
    const hi = Math.max(...all) * 1.05;
    const n = Math.max(...series.map((s) => s.points.length));
    const xFor = (i: number) => M.l + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
    const yFor = (v: number) => M.t + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
    const paths = series.map((s) =>
      s.points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.v)}`)
        .join(" "),
    );
    const first = series.find((s) => s.points.length > 0)?.points ?? [];
    const idxs = [
      0,
      Math.floor(first.length / 2),
      Math.max(0, first.length - 1),
    ];
    const xLabels = idxs.map((i) => first[i]?.t ?? "");
    return { lo, hi, paths, xLabels };
  }, [series, all, hasData]);

  if (!hasData) {
    return (
      <div className="flex h-[260px] items-center justify-center text-xs text-forest-500">
        No series data
      </div>
    );
  }

  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => lo + (i / yTicks) * (hi - lo));
  const xFor = (i: number, n: number) => M.l + (i / (n - 1)) * innerW;
  const yFor = (v: number) => M.t + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const first = series.find((s) => s.points.length > 0)?.points ?? [];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Combo price chart">
        {/* Y grid + labels */}
        {ticks.map((v, i) => (
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
            <text x={M.l - 6} y={yFor(v) + 3} textAnchor="end" fontSize={10} fill="#8ca395">
              ${Math.round(v).toLocaleString()}
            </text>
          </g>
        ))}

        {/* Series paths */}
        {series.map((s, i) => (
          <path
            key={s.name}
            d={paths[i]}
            fill="none"
            stroke={s.color}
            strokeWidth={s.dashed ? 1.5 : 2}
            strokeDasharray={s.dashed ? "4 3" : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* X labels: first / middle / last */}
        {xLabels.map((label, i, arr) => {
          const idx =
            i === 0 ? 0 : i === arr.length - 1 ? first.length - 1 : Math.floor(first.length / 2);
          return (
            <text
              key={`${label}-${i}`}
              x={xFor(idx, first.length)}
              y={H - 22}
              textAnchor={i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle"}
              fontSize={10}
              fill="#8ca395"
            >
              {label}
            </text>
          );
        })}

        {/* Inline legend along the bottom */}
        <g transform={`translate(${M.l}, ${H - 8})`} fontSize={11}>
          {series.map((s, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const x = col * 180;
            const y = row * 0;
            return (
              <g key={s.name} transform={`translate(${x}, ${y})`}>
                {s.dashed ? (
                  <line
                    x1={0}
                    x2={18}
                    y1={-4}
                    y2={-4}
                    stroke={s.color}
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                ) : (
                  <circle cx={9} cy={-4} r={3} fill={s.color} />
                )}
                <text x={24} y={0} fill="#c9dad1">
                  {s.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
