// Two-panel analytics block for /price-drops: a histogram of drop
// magnitudes and a frequency-over-time chart. Both pure SVG, server
// component, no client hydration.
//
// Histogram bins pct_change values from -90% .. 0% (drops only — we
// don't expect positives in the price_drops table by definition, but
// any positives that sneak in get clamped to the right-most bin).
//
// Frequency series shows daily drop counts over the last 30 days,
// with a thin moving-average overlay so the eye can read the trend.
import { fmtInt, fmtPct } from "@/lib/format";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const HIST_BIN_EDGES = [0, -5, -10, -15, -20, -30, -40, -50, -70, -90]; // descending magnitudes

export type DropPoint = {
  observed_at: string | null;
  pct_change: number | null;
};

function dayBucketIso(iso: string, windowStart: number): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const idx = Math.floor((t - windowStart) / DAY_MS);
  return idx >= 0 && idx < WINDOW_DAYS ? idx : null;
}

export default function DropAnalytics({ rows }: { rows: ReadonlyArray<DropPoint> }) {
  // Histogram —----------------------------------------------------------
  // Pre-compute bin counts. HIST_BIN_EDGES is monotonically descending;
  // a row with pct_change=-12 belongs in the bin [-10, -15] = index 2.
  const histCounts = Array.from({ length: HIST_BIN_EDGES.length }, () => 0);
  for (const r of rows) {
    const v = r.pct_change;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v >= 0) {
      histCounts[0]! += 1;
      continue;
    }
    let placed = false;
    for (let i = 1; i < HIST_BIN_EDGES.length; i++) {
      if (v >= HIST_BIN_EDGES[i]!) {
        histCounts[i - 1]! += 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      histCounts[histCounts.length - 1]! += 1;
    }
  }
  const histPeak = Math.max(1, ...histCounts);

  // Frequency series —---------------------------------------------------
  const sinceMs = Date.now() - WINDOW_DAYS * DAY_MS;
  const daily = Array.from({ length: WINDOW_DAYS }, () => 0);
  for (const r of rows) {
    if (!r.observed_at) continue;
    const idx = dayBucketIso(r.observed_at, sinceMs);
    if (idx === null) continue;
    daily[idx]! += 1;
  }
  // 7-day rolling mean (right-aligned)
  const rolling: number[] = [];
  for (let i = 0; i < daily.length; i++) {
    const lo = Math.max(0, i - 6);
    let sum = 0;
    let count = 0;
    for (let j = lo; j <= i; j++) {
      sum += daily[j]!;
      count++;
    }
    rolling.push(count > 0 ? sum / count : 0);
  }
  const freqPeak = Math.max(1, ...daily);

  // Frequency chart geometry
  const W = 720;
  const H = 200;
  const padX = 36;
  const padY = 18;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const stepX = innerW / (daily.length - 1 || 1);
  function pt(i: number, v: number): [number, number] {
    const x = padX + i * stepX;
    const y = padY + innerH - (v / freqPeak) * innerH;
    return [x, y];
  }
  const dailyPath = daily
    .map((v, i) => {
      const [x, y] = pt(i, v);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const rollingPath = rolling
    .map((v, i) => {
      const [x, y] = pt(i, v);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {/* Histogram --------------------------------------------------- */}
      <section className="surface p-5 lg:col-span-2">
        <header className="mb-4">
          <h2 className="font-display text-[18px] font-medium tracking-tight text-ink-50">
            Drop magnitude distribution
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            How aggressive are the price cuts we&apos;re seeing? Bins run from a
            5% trim on the left to deep 70%+ markdowns on the right.
          </p>
        </header>
        <div className="flex h-44 items-end gap-2">
          {histCounts.map((count, i) => {
            const h = (count / histPeak) * 100;
            const isMild = i < 3;
            const isAggressive = i >= 6;
            const bg = isAggressive
              ? "linear-gradient(180deg, #d76d62, #8e3a32)"
              : isMild
                ? "linear-gradient(180deg, #cd6e3c, #6b341a)"
                : "linear-gradient(180deg, #bda255, #5e5025)";
            const low = i === 0 ? "0" : `${HIST_BIN_EDGES[i]}%`;
            const high =
              i === HIST_BIN_EDGES.length - 1 ? "−90%+" : `${HIST_BIN_EDGES[i - 1] ?? 0}%`;
            return (
              <div
                key={i}
                className="group relative flex flex-1 flex-col items-center justify-end"
                title={`${low} to ${high} · ${fmtInt(count)} drops`}
              >
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{ height: `${Math.max(2, h)}%`, background: bg }}
                />
                <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-ink-500">
                  {fmtPct((HIST_BIN_EDGES[i] ?? 0) - 2.5, 0)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Frequency --------------------------------------------------- */}
      <section className="surface p-5 lg:col-span-3">
        <header className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-[18px] font-medium tracking-tight text-ink-50">
              Drop frequency · last 30 days
            </h2>
            <p className="mt-1 text-xs text-ink-400">
              Daily count of price drops observed. The thicker line is a
              7-day rolling mean — easier to read direction.
            </p>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-500">
            n = {fmtInt(rows.length)}
          </span>
        </header>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          aria-label="Daily price-drop count"
          role="img"
        >
          {/* Y-axis labels */}
          {[0, 0.5, 1].map((frac) => {
            const y = padY + innerH * (1 - frac);
            return (
              <g key={frac}>
                <line
                  x1={padX}
                  x2={W - padX}
                  y1={y}
                  y2={y}
                  stroke="rgb(35,68,54)"
                  strokeDasharray="2 3"
                />
                <text
                  x={padX - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="rgb(174,191,181)"
                  fontFamily="var(--font-mono)"
                >
                  {Math.round(freqPeak * frac)}
                </text>
              </g>
            );
          })}
          {/* Daily points */}
          <path
            d={dailyPath}
            fill="none"
            stroke="rgb(178,89,41)"
            strokeWidth={1}
            strokeOpacity={0.55}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Rolling mean */}
          <path
            d={rollingPath}
            fill="none"
            stroke="#2dbf95"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <footer className="mt-2 flex items-center justify-between font-mono text-[10px] tabular-nums text-ink-500">
          <span>30d ago</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-3 bg-[rgb(178,89,41)]/55" />
              daily
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-3 bg-claude-glow" />
              7d avg
            </span>
          </span>
          <span>today</span>
        </footer>
      </section>
    </div>
  );
}
