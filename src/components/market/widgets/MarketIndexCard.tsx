"use client";
// Geck Inspect Market Index hero card. Mirrors the top widget in the
// handoff screenshots:
//   - title + methodology link
//   - big value + "X% over period" delta
//   - source-badge row (click a badge → filters the dashboard to that source)
//   - area chart with crosshair hover tooltip
//   - confidence badge top-right
import { AreaChart } from "@/components/market/charts/InlineCharts";
import SourceBadge, { SourceBadgeList } from "@/components/market/SourceBadge";
import ConfidenceBadge from "@/components/market/ConfidenceBadge";
import LivePreviewTag, {
  type LivePreviewStatus,
} from "@/components/market/LivePreviewTag";
import type { MarketIndex } from "@/lib/market/fixtures";
import type { Filters, SourceId } from "@/lib/market/types";

export default function MarketIndexCard({
  data,
  onFilterBySource,
  filters,
  status,
  note,
}: {
  data: MarketIndex;
  onFilterBySource?: (id: SourceId) => void;
  filters: Filters;
  status?: LivePreviewStatus;
  note?: string;
}) {
  const deltaPositive = data.deltaPct >= 0;
  const deltaColor = deltaPositive ? "text-ready" : "text-danger";
  const deltaArrow = deltaPositive ? "▲" : "▼";

  // A source badge is "active" when filters.sources narrows to just it.
  const isActive = (id: SourceId): boolean => {
    if (filters.sources === "all") return false;
    return filters.sources.size === 1 && filters.sources.has(id);
  };

  return (
    <section className="forest-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
          >
            ◈
          </span>
          <div>
            <h2 className="font-display text-[18px] font-medium tracking-tight text-forest-50">
              Geck Inspect Market Index
            </h2>
            <p className="mt-0.5 text-xs text-forest-400">
              Weighted basket of high-value trait combinations — 1,000 at
              period start
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status ? <LivePreviewTag status={status} note={note} /> : null}
          <ConfidenceBadge score={data.attribution.confidence.score} size="md" />
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-5xl font-semibold tabular-nums text-ready">
            {data.value.toLocaleString()}
          </div>
          <div className={`mt-1 flex items-center gap-2 text-sm ${deltaColor}`}>
            <span className="font-mono">{deltaArrow}</span>
            <span className="font-semibold">
              {Math.abs(data.deltaPct).toFixed(1)}%
            </span>
            <span className="text-forest-400">over period</span>
          </div>
        </div>

        {/* Source attribution row. The first three sources render as live
            filter chips; any overflow collapses into "+N more". */}
        <div className="flex flex-wrap items-center gap-2">
          {data.attribution.sources.slice(0, 3).map((id) => (
            <SourceBadge
              key={id}
              id={id}
              size="md"
              active={isActive(id)}
              onClick={onFilterBySource ? () => onFilterBySource(id) : undefined}
            />
          ))}
          {data.attribution.sources.length > 3 ? (
            <span className="rounded-md border border-forest-700 bg-forest-900/80 px-2 py-1 font-mono text-xs text-forest-300">
              +{data.attribution.sources.length - 3} more
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <AreaChart
          data={data.series}
          color="#2dbf95"
          tooltipLabel="Index"
          height={260}
        />
      </div>

      <footer className="mt-3 flex items-center justify-between text-[11px] text-forest-500">
        <span className="inline-flex items-center gap-1.5 font-mono">
          <span aria-hidden>◷</span>
          Freshness ≤ 12h
        </span>
        <SourceBadgeList
          ids={data.attribution.sources}
          max={4}
          onBadgeClick={onFilterBySource}
        />
      </footer>
    </section>
  );
}
