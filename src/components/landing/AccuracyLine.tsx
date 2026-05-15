"use client";
// Tiny inline SVG line chart of accuracy-over-time. No d3 needed — five
// runs is enough to eyeball a trend without dragging in a chart lib.
//
// X axis = run start time, Y axis = accuracy (0–1). Points colored by
// status (success=emerald, failed=rose).
import { useMemo } from "react";
import type { EvalRun } from "@/lib/training/evalRuns";

type Props = {
  runs: EvalRun[];
  height?: number;
};

const PADDING = { top: 12, right: 12, bottom: 22, left: 36 };

export default function AccuracyLine({ runs, height = 180 }: Props) {
  const data = useMemo(() => {
    return runs
      .filter((r) => r.primary_morph_top1_accuracy != null)
      .slice()
      .reverse(); // oldest → newest left-to-right
  }, [runs]);

  if (data.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-ink-700 text-xs text-ink-500">
        No successful eval runs yet — run scripts/eval_morph_id.py to populate.
      </div>
    );
  }

  // We render into a 600-unit wide viewBox; the SVG scales to container.
  const W = 600;
  const H = height;
  const innerW = W - PADDING.left - PADDING.right;
  const innerH = H - PADDING.top - PADDING.bottom;

  const xs = data.map((_, i) => (i / Math.max(1, data.length - 1)) * innerW);
  const ys = data.map(
    (d) => innerH - ((d.primary_morph_top1_accuracy ?? 0) * innerH),
  );

  const path = xs
    .map((x, i) => (i === 0 ? `M ${x} ${ys[i]}` : `L ${x} ${ys[i]}`))
    .join(" ");

  // Y gridlines at 0, 0.25, 0.5, 0.75, 1
  const gridYs = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-44 w-full"
        preserveAspectRatio="none"
      >
        {/* Y gridlines + labels */}
        {gridYs.map((g) => {
          const y = innerH - g * innerH + PADDING.top;
          return (
            <g key={g}>
              <line
                x1={PADDING.left}
                x2={PADDING.left + innerW}
                y1={y}
                y2={y}
                stroke="rgb(51,65,85)"
                strokeWidth="1"
                strokeDasharray="2 4"
              />
              <text
                x={PADDING.left - 4}
                y={y + 4}
                textAnchor="end"
                className="fill-ink-500"
                style={{ fontSize: 10, fontFamily: "monospace" }}
              >
                {(g * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* X labels: first / middle / last */}
        {[0, Math.floor(data.length / 2), data.length - 1]
          .filter((i, j, arr) => arr.indexOf(i) === j)
          .map((i) => {
            const d = data[i];
            const x = PADDING.left + xs[i];
            return (
              <text
                key={i}
                x={x}
                y={H - 6}
                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                className="fill-ink-500"
                style={{ fontSize: 10, fontFamily: "monospace" }}
              >
                {new Date(d.started_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </text>
            );
          })}

        <g transform={`translate(${PADDING.left}, ${PADDING.top})`}>
          {/* Path */}
          <path
            d={path}
            fill="none"
            stroke="rgb(16,185,129)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Points */}
          {data.map((d, i) => (
            <circle
              key={d.id}
              cx={xs[i]}
              cy={ys[i]}
              r="3.5"
              fill={d.status === "success" ? "rgb(16,185,129)" : "rgb(244,63,94)"}
              stroke="rgb(15,23,42)"
              strokeWidth="1.5"
            >
              <title>
                {new Date(d.started_at).toLocaleString()} ·{" "}
                {((d.primary_morph_top1_accuracy ?? 0) * 100).toFixed(1)}% ·{" "}
                n={d.eval_set_size}
                {d.notes ? ` · ${d.notes}` : ""}
              </title>
            </circle>
          ))}
        </g>
      </svg>
    </div>
  );
}
