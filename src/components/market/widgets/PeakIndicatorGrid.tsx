"use client";
// Peak Indicator grid. Matches the handoff screenshots — a 3-up card
// layout with a colored label (PEAKING / FAIR VALUE / ACCUMULATE), the
// combo name, the 0..100 score on the right, the recommended action,
// sample size, a green→amber→red gradient bar with a marker, and a
// confidence badge in the bottom-left.
import ConfidenceBadge from "@/components/market/ConfidenceBadge";
import type { PeakIndicator, PeakTier } from "@/lib/market/fixtures";

const TIER_META: Record<
  PeakTier,
  { label: string; tint: string; text: string; marker: string }
> = {
  Peaking: {
    label: "PEAKING",
    tint: "bg-busy/10 border-busy/40",
    text: "text-busy",
    marker: "#fbbf24",
  },
  "Fair value": {
    label: "FAIR VALUE",
    tint: "bg-yellow-500/10 border-yellow-500/30",
    text: "text-yellow-300",
    marker: "#fde047",
  },
  Accumulate: {
    label: "ACCUMULATE",
    tint: "bg-ready/10 border-ready/40",
    text: "text-ready",
    marker: "#34d399",
  },
};

export default function PeakIndicatorGrid({
  indicators,
}: {
  indicators: PeakIndicator[];
}) {
  return (
    <section className="forest-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
          >
            ⏱
          </span>
          <div>
            <h2 className="text-base font-semibold text-forest-50">
              Peak Indicator — Hold, Sell, or Accumulate
            </h2>
            <p className="mt-0.5 text-xs text-forest-400">
              Composite 0–100 score. Higher = market heat, lower = early /
              undervalued.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-forest-700 bg-forest-950/40 px-2 py-1 text-[10px] text-forest-300 hover:text-forest-100"
          title="Methodology (coming soon)"
        >
          <span aria-hidden>ⓘ</span>
          Methodology
        </button>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {indicators.map((ind) => (
          <PeakCard key={ind.combo} ind={ind} />
        ))}
        {indicators.length === 0 ? (
          <p className="col-span-full py-6 text-center text-xs text-forest-500">
            No combos matched the current filter.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PeakCard({ ind }: { ind: PeakIndicator }) {
  const meta = TIER_META[ind.tier];
  return (
    <article
      className={`relative rounded-lg border p-4 transition hover:brightness-110 ${meta.tint}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`font-mono text-[10px] tracking-wider ${meta.text}`}>
            {meta.label}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-forest-50">
            {ind.combo}
          </div>
          <div className={`mt-0.5 text-xs ${meta.text}`}>
            {ind.action} · n={ind.n}
          </div>
        </div>
        <div className={`text-3xl font-semibold tabular-nums ${meta.text}`}>
          {ind.score}
        </div>
      </header>

      <GradientBar score={ind.score} markerColor={meta.marker} />

      <footer className="mt-3 flex items-center justify-between gap-2">
        <ConfidenceBadge score={ind.attribution.confidence.score} size="sm" />
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-forest-400 hover:bg-forest-850 hover:text-forest-100"
          title="Open combo detail (Combos tab)"
        >
          ↗
        </button>
      </footer>
    </article>
  );
}

function GradientBar({ score, markerColor }: { score: number; markerColor: string }) {
  // Continuous green→amber→red gradient. Marker sits at `score%`.
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="mt-3 h-1.5 w-full rounded-full bg-gradient-to-r from-ready via-busy to-danger">
      <div className="relative h-full">
        <span
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-sm"
          style={{ left: `${clamped}%`, backgroundColor: markerColor }}
          aria-label={`Score ${clamped} of 100`}
        />
      </div>
    </div>
  );
}
