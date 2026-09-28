"use client";
// The past year by the month listings were posted, from the sampled
// backfill. Months the backfill has not reached are hatched and labeled
// "Not read yet", never drawn as zero. A price point needs at least
// MIN_PRICED sampled listings; below that the month shows no point and the
// tooltip says why. Same palette and single-axis rule as the weekly charts.
import { useState } from "react";
import type { MonthRow } from "@/lib/simple/data";
import { MIN_PRICED, fmtMonth } from "@/lib/simple/trend";
import { LINE } from "@/components/charts/series";

const SLOT1 = "rgb(var(--series-a))";
const SURFACE = "rgb(var(--ink-850))";
const GRID = "rgb(var(--ink-700))";
const MUTED = "rgb(var(--ink-400))";

const W = 720;
const PAD = { l: 52, r: 16, t: 22, b: 30 };

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const int = (v: number) => Math.round(v).toLocaleString("en-US");

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

const priced = (r: MonthRow) => r.covered && r.priced >= MIN_PRICED && r.p50 != null;

export function MonthlyChart({ rows, kind }: { rows: MonthRow[]; kind: "price" | "posted" }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return null;
  const H = kind === "price" ? 280 : 220;
  const bottom = H - PAD.b;
  const band = (W - PAD.l - PAD.r) / rows.length;
  const cx = (i: number) => PAD.l + band * (i + 0.5);

  const values =
    kind === "price"
      ? rows.filter(priced).map((r) => (r.p75 ?? r.p50) as number)
      : rows.filter((r) => r.covered).map((r) => r.estPosted);
  if (!values.length || Math.max(...values) <= 0) return null;
  const yMax = niceCeil(Math.max(...values) * 1.05);
  const y = (v: number) => PAD.t + (1 - v / yMax) * (bottom - PAD.t);
  const ticks = (kind === "price" ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1]).map((f) => yMax * f);
  const fmt = kind === "price" ? (v: number) => (v === 0 ? "$0" : usd(v)) : int;

  // Contiguous runs of priced months, so a line never bridges a gap.
  const runs: number[][] = [];
  rows.forEach((r, i) => {
    if (!priced(r)) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else runs.push([i]);
  });
  // Unread stretches, drawn once each.
  const unread: Array<[number, number]> = [];
  rows.forEach((r, i) => {
    if (r.covered) return;
    const last = unread[unread.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else unread.push([i, i]);
  });
  const hr = hover != null ? rows[hover] : null;
  const barW = Math.min(28, band * 0.55);

  return (
    <figure className="space-y-3">
      {kind === "price" ? (
        <div className="flex flex-wrap gap-4 text-sm text-ink-300" aria-hidden="true">
          <span className="inline-flex items-center gap-2">
            <span className="h-[2px] w-4" style={{ background: SLOT1 }} />
            Middle asking price
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-4" style={{ background: SLOT1, opacity: 0.18 }} />
            Middle half of prices
          </span>
        </div>
      ) : null}
      <div className="-mx-2 overflow-x-auto px-2">
        <div className="relative min-w-[560px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={
              kind === "price"
                ? `Middle asking price by month posted: ${rows
                    .map((r) => `${fmtMonth(r.month, true)} ${priced(r) ? usd(r.p50!) : r.covered ? "too few" : "not read yet"}`)
                    .join(", ")}.`
                : `Estimated listings posted by month: ${rows
                    .map((r) => `${fmtMonth(r.month, true)} ${r.covered ? int(r.estPosted) : "not read yet"}`)
                    .join(", ")}.`
            }
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <pattern id={`unread-${kind}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="8" stroke="rgb(var(--ink-600))" strokeWidth="2" />
              </pattern>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
                <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>
                  {fmt(t)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => (
              <text key={r.month} x={cx(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={MUTED}>
                {fmtMonth(r.month)}
              </text>
            ))}
            {unread.map(([a, b]) => (
              <g key={`u-${a}`}>
                <rect
                  x={PAD.l + band * a + 2}
                  y={PAD.t}
                  width={band * (b - a + 1) - 4}
                  height={bottom - PAD.t}
                  fill={`url(#unread-${kind})`}
                  opacity={0.5}
                />
                <text x={PAD.l + band * ((a + b + 1) / 2)} y={PAD.t - 8} textAnchor="middle" fontSize={11} fill="rgb(var(--ink-400))">
                  Not read yet
                </text>
              </g>
            ))}
            {hover != null ? (
              <line x1={cx(hover)} x2={cx(hover)} y1={PAD.t} y2={bottom} stroke="rgb(var(--ink-600))" />
            ) : null}
            {kind === "price"
              ? runs.map((run) => (
                  <g key={run[0]}>
                    {run.length > 1 ? (
                      <>
                        <polygon
                          fill={SLOT1}
                          opacity={0.12}
                          points={[
                            ...run.map((i) => `${cx(i)},${y(rows[i].p75 ?? rows[i].p50!)}`),
                            ...[...run].reverse().map((i) => `${cx(i)},${y(rows[i].p25 ?? rows[i].p50!)}`),
                          ].join(" ")}
                        />
                        <polyline
                          {...LINE}
                          stroke={SLOT1}
                          points={run.map((i) => `${cx(i)},${y(rows[i].p50!)}`).join(" ")}
                        />
                      </>
                    ) : null}
                    {run
                      .filter((i) => i === hover || run.length === 1)
                      .map((i) => (
                        <rect key={i} x={cx(i) - 3} y={y(rows[i].p50!) - 3} width={6} height={6} fill={SLOT1} stroke={SURFACE} strokeWidth={1} />
                      ))}
                  </g>
                ))
              : rows.map((r, i) => {
                  if (!r.covered || r.estPosted <= 0) return null;
                  const top = y(r.estPosted);
                  const x0 = cx(i) - barW / 2;
                  return (
                    <rect
                      key={r.month}
                      x={x0}
                      y={top}
                      width={barW}
                      height={bottom - top}
                      fill={SLOT1}
                      opacity={hover == null || hover === i ? 1 : 0.55}
                    />
                  );
                })}
            {rows.map((r, i) => (
              <rect
                key={`hit-${r.month}`}
                x={PAD.l + band * i}
                y={PAD.t}
                width={band}
                height={bottom - PAD.t}
                fill="transparent"
                tabIndex={0}
                aria-label={`${fmtMonth(r.month, true)}: ${
                  !r.covered
                    ? "not read yet"
                    : kind === "price"
                      ? priced(r)
                        ? usd(r.p50!)
                        : `too few listings (${r.priced})`
                      : `about ${int(r.estPosted)} listings posted`
                }`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </svg>
          {hr ? (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-[11rem] rounded-lg border border-ink-700 bg-ink-900/95 px-3 py-2 text-xs shadow-lg"
              style={{
                left: `${(cx(hover!) / W) * 100}%`,
                transform: cx(hover!) > W * 0.6 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
              }}
            >
              <div className="mb-1 font-medium text-ink-100">Posted in {fmtMonth(hr.month, true)}</div>
              {!hr.covered ? (
                <div className="text-ink-400">Not read yet</div>
              ) : (
                <>
                  <Row k="Middle price" v={priced(hr) ? usd(hr.p50!) : "too few"} />
                  {priced(hr) && hr.p25 != null && hr.p75 != null ? (
                    <Row k="Middle half" v={`${usd(hr.p25)} to ${usd(hr.p75)}`} />
                  ) : null}
                  <Row k="Listings posted, est." v={`about ${int(hr.estPosted)}`} />
                  <Row k="Sampled" v={int(hr.sampled)} />
                  {hr.soldShare != null ? <Row k="Since sold" v={`${Math.round(hr.soldShare * 100)}%`} /> : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </figure>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 text-ink-300">
      {k}
      <span className="ml-auto tabular-nums text-ink-100">{v}</span>
    </div>
  );
}
