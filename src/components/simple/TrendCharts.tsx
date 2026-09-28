"use client";
// Week-by-week history charts. Time runs left to right at true scale, so a
// stretch with no scrape shows up as empty, labeled space instead of being
// squeezed out or drawn as zero. Lines only join back-to-back full weeks.
// A week where only part of the catalog was checked is a hollow marker:
// its middle price rests on a small sample.
//
// Colors come from the shared series gradient. Each chart has one y axis;
// counts and prices never share a chart.
import { useId, useState } from "react";
import type { TrendWeek } from "@/lib/simple/data";
import { fmtWeek, fullRuns, untracked, weekTime } from "@/lib/simple/trend";
import { LINE, SeriesDefs } from "@/components/charts/series";

const SLOT1 = "rgb(var(--series-a))";
const SLOT2 = "rgb(var(--series-b))";
const SURFACE = "rgb(var(--ink-850))";
const GRID = "rgb(var(--ink-700))";
const MUTED = "rgb(var(--ink-400))";

const W = 720;
const PAD = { l: 52, r: 20, t: 22, b: 30 };
const DAY = 86_400_000;

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const int = (v: number) => Math.round(v).toLocaleString("en-US");

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

function scaleFor(weeks: TrendWeek[], h: number) {
  const t0 = weekTime(weeks[0].week) - 3.5 * DAY;
  const t1 = weekTime(weeks[weeks.length - 1].week) + 3.5 * DAY;
  const x = (w: string) =>
    PAD.l + ((weekTime(w) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const weekW = ((7 * DAY) / (t1 - t0)) * (W - PAD.l - PAD.r);
  // Month ticks on the first of each month inside the range.
  const months: Array<{ at: number; label: string }> = [];
  const d = new Date(t0);
  let m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  while (m.getTime() < t1) {
    months.push({
      at: PAD.l + ((m.getTime() - t0) / (t1 - t0)) * (W - PAD.l - PAD.r),
      label: m.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
    });
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
  }
  const gaps = untracked(weeks).map((g) => ({
    ...g,
    x0: x(g.from) + weekW / 2,
    x1: x(g.to) - weekW / 2,
  }));
  return { x, weekW, months, gaps, bottom: h - PAD.b };
}

function Frame({
  h,
  scale,
  ticks,
  y,
  fmt,
}: {
  h: number;
  scale: ReturnType<typeof scaleFor>;
  ticks: number[];
  y: (v: number) => number;
  fmt: (v: number) => string;
}) {
  return (
    <>
      <defs>
        <pattern
          id="untracked-hatch"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgb(var(--ink-600))" strokeWidth="2" />
        </pattern>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(t)}
            y2={y(t)}
            stroke={GRID}
            strokeWidth={1}
          />
          <text
            x={PAD.l - 8}
            y={y(t) + 4}
            textAnchor="end"
            fontSize={11}
            fill={MUTED}
          >
            {fmt(t)}
          </text>
        </g>
      ))}
      {scale.months.map((m) => (
        <g key={m.label + m.at}>
          <line
            x1={m.at}
            x2={m.at}
            y1={scale.bottom}
            y2={scale.bottom + 4}
            stroke={MUTED}
          />
          <text x={m.at + 4} y={h - 10} fontSize={11} fill={MUTED}>
            {m.label}
          </text>
        </g>
      ))}
      {scale.gaps.map((g) =>
        g.x1 > g.x0 ? (
          <g key={g.from}>
            <rect
              x={g.x0}
              y={PAD.t}
              width={g.x1 - g.x0}
              height={scale.bottom - PAD.t}
              fill="url(#untracked-hatch)"
              opacity={0.5}
            />
            <text
              x={(g.x0 + g.x1) / 2}
              y={PAD.t - 8}
              textAnchor="middle"
              fontSize={11}
              fill="rgb(var(--ink-400))"
            >
              Not tracked ({g.weeks} weeks)
            </text>
          </g>
        ) : null,
      )}
    </>
  );
}

function Tip({
  left,
  flip,
  children,
}: {
  left: number;
  flip: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 min-w-[11rem] rounded-lg border border-ink-700 bg-ink-900/95 px-3 py-2 text-xs shadow-lg"
      style={{
        left: `${(left / W) * 100}%`,
        transform: flip ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
      }}
    >
      {children}
    </div>
  );
}

/** Middle asking price per week, with the middle half as a band. */
export function PriceTrendChart({
  weeks,
  label,
}: {
  weeks: TrendWeek[];
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = `g${useId().replace(/:/g, "")}`;
  const priced = weeks.filter((w) => w.p50 != null);
  if (priced.length < 2) return null;
  const H = 300;
  const s = scaleFor(weeks, H);
  const yMax = niceCeil(
    Math.max(...priced.map((w) => (w.p75 ?? w.p50) as number)) * 1.05,
  );
  const y = (v: number) => PAD.t + (1 - v / yMax) * (s.bottom - PAD.t);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);
  const runs = fullRuns(weeks);
  const hw = hover != null ? weeks[hover] : null;

  return (
    <figure className="space-y-3">
      <div
        className="flex flex-wrap gap-4 text-sm text-ink-300"
        aria-hidden="true"
      >
        <span className="inline-flex items-center gap-2">
          <span className="h-[2px] w-4" style={{ background: SLOT1 }} />
          Middle asking price
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-4" style={{ background: SLOT1, opacity: 0.18 }} />
          Middle half of prices
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 border" style={{ borderColor: SLOT1 }} />
          Partial check
        </span>
      </div>
      <div className="-mx-2 overflow-x-auto px-2">
        <div className="relative min-w-[560px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`${label}: middle asking price by week, ${priced
              .map(
                (w) =>
                  `${fmtWeek(w.week)} ${usd(w.p50!)}${w.partial ? " (partial)" : ""}`,
              )
              .join(", ")}.`}
            onMouseLeave={() => setHover(null)}
          >
            <SeriesDefs id={gid} x1={PAD.l} x2={W - PAD.r} y1={PAD.t} y2={s.bottom} />
            <Frame
              h={H}
              scale={s}
              ticks={ticks}
              y={y}
              fmt={(v) => (v === 0 ? "$0" : usd(v))}
            />
            {hover != null ? (
              <line
                x1={s.x(weeks[hover].week)}
                x2={s.x(weeks[hover].week)}
                y1={PAD.t}
                y2={s.bottom}
                stroke="rgb(var(--ink-600))"
              />
            ) : null}
            {runs.map((r) => (
              <g key={r[0].week}>
                {r.length > 1 &&
                r.every((w) => w.p25 != null && w.p75 != null) ? (
                  <polygon
                    fill={SLOT1}
                    opacity={0.12}
                    points={[
                      ...r.map((w) => `${s.x(w.week)},${y(w.p75!)}`),
                      ...[...r]
                        .reverse()
                        .map((w) => `${s.x(w.week)},${y(w.p25!)}`),
                    ].join(" ")}
                  />
                ) : null}
                {r.length > 1 ? (
                  <polyline
                    {...LINE}
                    stroke={`url(#${gid}-line)`}
                    points={r
                      .map((w) => `${s.x(w.week)},${y(w.p50!)}`)
                      .join(" ")}
                  />
                ) : null}
              </g>
            ))}
            {weeks.map((w, i) =>
              w.p50 == null ? null : (
                <rect
                  key={w.week}
                  x={s.x(w.week) - (hover === i ? 3.5 : 2.5)}
                  y={y(w.p50) - (hover === i ? 3.5 : 2.5)}
                  width={hover === i ? 7 : 5}
                  height={hover === i ? 7 : 5}
                  fill={w.partial ? SURFACE : SLOT1}
                  stroke={SLOT1}
                  strokeWidth={1}
                />
              ),
            )}
            {weeks.map((w, i) => (
              <rect
                key={`hit-${w.week}`}
                x={s.x(w.week) - Math.max(s.weekW, 16) / 2}
                y={PAD.t}
                width={Math.max(s.weekW, 16)}
                height={s.bottom - PAD.t}
                fill="transparent"
                tabIndex={0}
                aria-label={`Week of ${fmtWeek(w.week, true)}: ${w.p50 != null ? usd(w.p50) : "no price"}, ${int(w.seen)} listings checked${w.partial ? ", partial check" : ""}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </svg>
          {hw && hw.p50 != null ? (
            <Tip left={s.x(hw.week)} flip={s.x(hw.week) > W * 0.6}>
              <div className="mb-1 font-medium text-ink-100">
                Week of {fmtWeek(hw.week, true)}
              </div>
              <Row k="Middle price" v={usd(hw.p50)} />
              {hw.p25 != null && hw.p75 != null ? (
                <Row k="Middle half" v={`${usd(hw.p25)} to ${usd(hw.p75)}`} />
              ) : null}
              <Row k="Listings checked" v={int(hw.seen)} />
              {hw.partial ? (
                <div className="mt-1 text-ink-500">
                  Partial check, small sample
                </div>
              ) : null}
            </Tip>
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

type BarSeries = {
  key: string;
  label: string;
  get: (w: TrendWeek) => number | null;
};

// Defined here, not passed in: a server page cannot hand functions to a
// client component. Counts right after a gap span the whole gap, so they
// are left out.
const BAR_KINDS: Record<
  "changes" | "flow",
  { label: string; series: [BarSeries, BarSeries] }
> = {
  changes: {
    label: "Price cuts and raises",
    series: [
      {
        key: "cuts",
        label: "Cut price",
        get: (w) => (w.afterGap ? null : w.cuts),
      },
      {
        key: "raises",
        label: "Raised price",
        get: (w) => (w.afterGap ? null : w.raises),
      },
    ],
  },
  flow: {
    label: "New listings and listings that came down",
    series: [
      { key: "new", label: "New listings", get: (w) => w.newListings },
      { key: "down", label: "Came down", get: (w) => w.cameDown },
    ],
  },
};

/** Two counts per week as side-by-side bars. Weeks without a count get no bar. */
export function WeeklyBars({
  weeks,
  kind,
}: {
  weeks: TrendWeek[];
  kind: keyof typeof BAR_KINDS;
}) {
  const { label, series } = BAR_KINDS[kind];
  const [hover, setHover] = useState<number | null>(null);
  const colors = [SLOT1, SLOT2];
  const vals = weeks
    .flatMap((w) => series.map((sr) => sr.get(w)))
    .filter((v): v is number => v != null);
  if (!vals.length || Math.max(...vals) <= 0) return null;
  const H = 220;
  const s = scaleFor(weeks, H);
  const yMax = niceCeil(Math.max(...vals) * 1.05);
  const y = (v: number) => PAD.t + (1 - v / yMax) * (s.bottom - PAD.t);
  const ticks = [0, 0.5, 1].map((f) => yMax * f);
  const barW = Math.max(3, Math.min(18, s.weekW * 0.32));
  const hw = hover != null ? weeks[hover] : null;

  return (
    <figure className="space-y-3">
      <div
        className="flex flex-wrap gap-4 text-sm text-ink-300"
        aria-hidden="true"
      >
        {series.map((sr, i) => (
          <span key={sr.key} className="inline-flex items-center gap-2">
            <span className="h-3 w-3" style={{ background: colors[i] }} />
            {sr.label}
          </span>
        ))}
      </div>
      <div className="-mx-2 overflow-x-auto px-2">
        <div className="relative min-w-[560px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`${label} by week. ${weeks
              .map(
                (w) =>
                  `${fmtWeek(w.week)}: ${series.map((sr) => `${sr.label} ${sr.get(w) ?? "not counted"}`).join(", ")}`,
              )
              .join(". ")}.`}
            onMouseLeave={() => setHover(null)}
          >
            <Frame h={H} scale={s} ticks={ticks} y={y} fmt={(v) => int(v)} />
            {weeks.map((w, i) =>
              series.map((sr, j) => {
                const v = sr.get(w);
                if (v == null || v <= 0) return null;
                const bx = s.x(w.week) + (j === 0 ? -barW - 1 : 1);
                const top = y(v);
                return (
                  <rect
                    key={`${w.week}-${sr.key}`}
                    x={bx}
                    y={top}
                    width={barW}
                    height={s.bottom - top}
                    fill={colors[j]}
                    opacity={hover == null || hover === i ? 1 : 0.55}
                  />
                );
              }),
            )}
            {weeks.map((w, i) => (
              <rect
                key={`hit-${w.week}`}
                x={s.x(w.week) - Math.max(s.weekW, 16) / 2}
                y={PAD.t}
                width={Math.max(s.weekW, 16)}
                height={s.bottom - PAD.t}
                fill="transparent"
                tabIndex={0}
                aria-label={`Week of ${fmtWeek(w.week, true)}: ${series.map((sr) => `${sr.label} ${sr.get(w) ?? "not counted"}`).join(", ")}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </svg>
          {hw ? (
            <Tip left={s.x(hw.week)} flip={s.x(hw.week) > W * 0.6}>
              <div className="mb-1 font-medium text-ink-100">
                Week of {fmtWeek(hw.week, true)}
              </div>
              {series.map((sr) => {
                const v = sr.get(hw);
                return (
                  <Row
                    key={sr.key}
                    k={sr.label}
                    v={v == null ? "not counted" : int(v)}
                  />
                );
              })}
            </Tip>
          ) : null}
        </div>
      </div>
    </figure>
  );
}
