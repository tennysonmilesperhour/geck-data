"use client";
// How a crested gecko's asking price climbs as it grows, split by sex.
// Live animals are the one collectible that appreciates on its own: a
// hatchling becomes a sexed, breedable adult. This chart shows that curve.
//
// One axis (price), one line per sex, points only where enough listings
// back them. Colors are the validated categorical slots 1 to 3 for the
// dark surface; every line is also direct-labeled, so color never carries
// identity alone. Hover or focus shows the values for a weight bucket.
import { useState } from "react";
import type { GrowthPoint } from "@/lib/simple/data";

const SERIES = [
  { key: "female", label: "Female", color: "#3987e5" },
  { key: "male", label: "Male", color: "#d95926" },
  { key: "unsexed", label: "Not sexed", color: "#199e70" },
] as const;

const LABELS = ["<5g", "5-10g", "10-15g", "15-20g", "20-30g", "30-40g", "40-50g", "50g+"];
const MIN_POINT = 6;

const W = 720;
const H = 280;
const PAD = { l: 52, r: 84, t: 16, b: 34 };

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export default function GrowthChart({ points }: { points: GrowthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const lines = SERIES.map((s) => ({
    ...s,
    pts: points
      .filter((p) => p.sex === s.key && p.n >= MIN_POINT && p.p50 != null)
      .sort((a, b) => a.bucket - b.bucket),
  })).filter((s) => s.pts.length >= 2);

  if (!lines.length) return null;

  const maxY = Math.max(...lines.flatMap((l) => l.pts.map((p) => p.p50 as number)));
  const yMax = [200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 5000].find((v) => v >= maxY * 1.08) ?? maxY * 1.1;
  const x = (b: number) => PAD.l + (b / 7) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));

  const at = (b: number) =>
    lines
      .map((l) => ({ l, p: l.pts.find((p) => p.bucket === b) }))
      .filter((r) => r.p);

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm text-ink-300" aria-hidden="true">
        {lines.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-2">
            <span className="h-0.5 w-5 rounded-full" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Asking price by weight. ${lines
            .map((l) => `${l.label}: ${usd(l.pts[0].p50!)} at ${LABELS[l.pts[0].bucket]} to ${usd(l.pts[l.pts.length - 1].p50!)} at ${LABELS[l.pts[l.pts.length - 1].bucket]}`)
            .join(". ")}.`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#1e293b" strokeWidth={1} />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">
                {t === 0 ? "$0" : usd(t)}
              </text>
            </g>
          ))}
          {LABELS.map((lab, b) => (
            <text key={lab} x={x(b)} y={H - 10} textAnchor="middle" fontSize={11} fill="#64748b">
              {lab}
            </text>
          ))}
          {hover != null ? (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="#475569" strokeWidth={1} />
          ) : null}
          {lines.map((l) => (
            <g key={l.key}>
              <polyline
                fill="none"
                stroke={l.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={l.pts.map((p) => `${x(p.bucket)},${y(p.p50!)}`).join(" ")}
              />
              {l.pts.map((p) => (
                <circle
                  key={p.bucket}
                  cx={x(p.bucket)}
                  cy={y(p.p50!)}
                  r={hover === p.bucket ? 5 : 3.5}
                  fill={l.color}
                  stroke="#0f172a"
                  strokeWidth={2}
                />
              ))}
              <text
                x={x(l.pts[l.pts.length - 1].bucket) + 10}
                y={y(l.pts[l.pts.length - 1].p50!) + 4}
                fontSize={12}
                fill="#cbd5e1"
              >
                {l.label}
              </text>
            </g>
          ))}
          {LABELS.map((lab, b) => (
            <rect
              key={`hit-${lab}`}
              x={x(b) - (W - PAD.l - PAD.r) / 14}
              y={PAD.t}
              width={(W - PAD.l - PAD.r) / 7}
              height={H - PAD.t - PAD.b}
              fill="transparent"
              tabIndex={0}
              aria-label={`${lab}: ${at(b).map((r) => `${r.l.label} ${usd(r.p!.p50!)}`).join(", ") || "not enough listings"}`}
              onMouseEnter={() => setHover(b)}
              onFocus={() => setHover(b)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>
        {hover != null && at(hover).length ? (
          <div
            className="pointer-events-none absolute top-2 rounded-lg border border-ink-700 bg-ink-900/95 px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: hover > 4 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            }}
          >
            <div className="mb-1 font-medium text-ink-100">{LABELS[hover]}</div>
            {at(hover).map((r) => (
              <div key={r.l.key} className="flex items-center gap-2 text-ink-300">
                <span className="h-2 w-2 rounded-full" style={{ background: r.l.color }} />
                {r.l.label}
                <span className="ml-auto pl-3 tabular-nums text-ink-100">{usd(r.p!.p50!)}</span>
                <span className="text-ink-500">n={r.p!.n}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <details className="text-sm text-ink-400">
        <summary className="cursor-pointer hover:text-ink-200">Show as a table</summary>
        <table className="plain mt-2 w-full text-left text-xs">
          <thead>
            <tr>
              <th className="py-1 pr-3 font-medium">Weight</th>
              {lines.map((l) => (
                <th key={l.key} className="py-1 pr-3 font-medium">
                  {l.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LABELS.map((lab, b) => (
              <tr key={lab} className="border-t border-ink-800">
                <td className="py-1 pr-3">{lab}</td>
                {lines.map((l) => {
                  const p = l.pts.find((q) => q.bucket === b);
                  return (
                    <td key={l.key} className="py-1 pr-3 tabular-nums">
                      {p ? `${usd(p.p50!)} (${p.n})` : "few"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
