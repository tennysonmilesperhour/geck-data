"use client";
// Several price lines on one time axis: morphs against each other, or one
// morph across markets. Time runs at true scale and a line breaks wherever
// its points are further apart than `maxGapDays`, so an untracked stretch
// is never bridged. Up to six series take colors sampled in order from one
// gradient (the caller keeps that order stable so a series keeps its
// color). Every line is labeled at its end, with a legend and a table
// view, so color never carries identity alone.
import { useState } from "react";
import { LINE, seriesColor } from "@/components/charts/series";

export type LinePoint = { x: string; y: number; n?: number };
export type LineSeries = { key: string; label: string; points: LinePoint[] };

const MAX_SERIES = 6;
const SURFACE = "rgb(var(--ink-850))";
const GRID = "rgb(var(--ink-700))";
const MUTED = "rgb(var(--ink-400))";
const DAY = 86_400_000;

const W = 720;
const H = 300;
const PAD = { l: 56, r: 118, t: 16, b: 30 };

const t = (x: string) => Date.parse(x.length === 10 ? `${x}T00:00:00Z` : x);
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const fmtDate = (x: string, long = false) =>
  new Date(t(x)).toLocaleDateString("en-US", {
    month: "short",
    ...(long ? { day: "numeric", year: "numeric" } : {}),
    timeZone: "UTC",
  });

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

function runs(points: LinePoint[], maxGapDays: number): LinePoint[][] {
  const out: LinePoint[][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && t(p.x) - t(last[last.length - 1].x) <= maxGapDays * DAY) last.push(p);
    else out.push([p]);
  }
  return out;
}

export default function MultiLineChart({
  series,
  maxGapDays = 7,
  caption,
}: {
  series: LineSeries[];
  maxGapDays?: number;
  caption?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const kept = series.slice(0, MAX_SERIES);
  const shown = kept
    .map((s, i) => ({ ...s, color: seriesColor(i, kept.length), points: [...s.points].sort((a, b) => t(a.x) - t(b.x)) }))
    .filter((s) => s.points.length);
  if (!shown.length) return null;

  const xs = [...new Set(shown.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => t(a) - t(b));
  const t0 = t(xs[0]) - 3.5 * DAY;
  const t1 = t(xs[xs.length - 1]) + 3.5 * DAY;
  const x = (v: string) => PAD.l + ((t(v) - t0) / Math.max(t1 - t0, DAY)) * (W - PAD.l - PAD.r);
  const yMax = niceCeil(Math.max(...shown.flatMap((s) => s.points.map((p) => p.y))) * 1.08);
  const y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);

  // Month ticks.
  const months: Array<{ at: number; label: string }> = [];
  const d0 = new Date(t0);
  for (let m = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1); m < t1; ) {
    const d = new Date(m);
    months.push({ at: x(d.toISOString().slice(0, 10)), label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) });
    m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const monthStep = Math.ceil(months.length / 8);

  // End labels, nudged apart so they never overlap.
  const labels = shown
    .map((s) => {
      const last = s.points[s.points.length - 1];
      return { key: s.key, label: s.label, color: s.color, x: x(last.x), y: y(last.y) };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  }

  const at = hover ? shown.map((s) => ({ s, p: s.points.find((p) => p.x === hover) })).filter((r) => r.p) : [];
  const hx = hover ? x(hover) : 0;

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm text-ink-300" aria-hidden="true">
        {shown.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <span className="h-[2px] w-4" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="-mx-2 overflow-x-auto px-2">
        <div className="relative min-w-[560px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={
              caption ??
              shown
                .map((s) => `${s.label}: ${s.points.map((p) => `${fmtDate(p.x, true)} ${usd(p.y)}`).join(", ")}`)
                .join(". ")
            }
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={GRID} />
                <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill={MUTED}>
                  {v === 0 ? "$0" : usd(v)}
                </text>
              </g>
            ))}
            {months.length >= 3
              ? months.map((m, i) =>
                  i % monthStep === 0 ? (
                    <text key={m.at} x={m.at + 3} y={H - 10} fontSize={11} fill={MUTED}>
                      {m.label}
                    </text>
                  ) : null,
                )
              : // A short span: label the weeks themselves.
                xs.map((v, i) =>
                  i % Math.ceil(xs.length / 8) === 0 ? (
                    <text key={v} x={x(v)} y={H - 10} textAnchor="middle" fontSize={11} fill={MUTED}>
                      {new Date(t(v)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                    </text>
                  ) : null,
                )}
            {hover ? <line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} stroke="rgb(var(--ink-600))" /> : null}
            {shown.map((s) => (
              <g key={s.key}>
                {runs(s.points, maxGapDays).map((r) =>
                  r.length > 1 ? (
                    <polyline
                      key={r[0].x}
                      {...LINE}
                      stroke={s.color}
                      points={r.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
                    />
                  ) : null,
                )}
                {s.points
                  .filter((p) => p.x === hover || runs(s.points, maxGapDays).some((r) => r.length === 1 && r[0].x === p.x))
                  .map((p) => (
                    <rect key={p.x} x={x(p.x) - 2.5} y={y(p.y) - 2.5} width={5} height={5} fill={s.color} stroke={SURFACE} strokeWidth={1} />
                  ))}
              </g>
            ))}
            {labels.map((l) => (
              <text key={l.key} x={Math.min(l.x + 8, W - PAD.r + 8)} y={l.y + 4} fontSize={11} fill="rgb(var(--ink-300))">
                {l.label.length > 16 ? `${l.label.slice(0, 15)}…` : l.label}
              </text>
            ))}
            {xs.map((v, i) => {
              const left = i === 0 ? PAD.l : (x(xs[i - 1]) + x(v)) / 2;
              const right = i === xs.length - 1 ? W - PAD.r : (x(v) + x(xs[i + 1])) / 2;
              return (
                <rect
                  key={`hit-${v}`}
                  x={left}
                  y={PAD.t}
                  width={Math.max(right - left, 1)}
                  height={H - PAD.t - PAD.b}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${fmtDate(v, true)}: ${shown
                    .map((s) => {
                      const p = s.points.find((q) => q.x === v);
                      return `${s.label} ${p ? usd(p.y) : "no data"}`;
                    })
                    .join(", ")}`}
                  onMouseEnter={() => setHover(v)}
                  onFocus={() => setHover(v)}
                  onBlur={() => setHover(null)}
                />
              );
            })}
          </svg>
          {hover && at.length ? (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-[11rem] rounded-lg border border-ink-700 bg-ink-900/95 px-3 py-2 text-xs shadow-lg"
              style={{ left: `${(hx / W) * 100}%`, transform: hx > W * 0.55 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
            >
              <div className="mb-1 font-medium text-ink-100">Week of {fmtDate(hover, true)}</div>
              {at.map(({ s, p }) => (
                <div key={s.key} className="flex items-center gap-2 text-ink-300">
                  <span className="h-[2px] w-3" style={{ background: s.color }} />
                  {s.label}
                  <span className="ml-auto pl-3 tabular-nums text-ink-100">{usd(p!.y)}</span>
                  {p!.n != null ? <span className="text-ink-500">n={p!.n}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <details className="text-sm text-ink-400">
        <summary className="cursor-pointer hover:text-ink-200">Show as a table</summary>
        <div className="overflow-x-auto">
          <table className="plain mt-2 w-full text-left text-xs">
            <thead>
              <tr>
                <th className="py-1 pr-3 font-medium">Week of</th>
                {shown.map((s) => (
                  <th key={s.key} className="py-1 pr-3 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xs.map((v) => (
                <tr key={v} className="border-t border-ink-800">
                  <td className="py-1 pr-3">{fmtDate(v, true)}</td>
                  {shown.map((s) => {
                    const p = s.points.find((q) => q.x === v);
                    return (
                      <td key={s.key} className="py-1 pr-3 tabular-nums">
                        {p ? `${usd(p.y)}${p.n != null ? ` (${p.n})` : ""}` : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
