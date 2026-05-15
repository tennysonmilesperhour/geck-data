"use client";
// Right-rail detail panel on the Combos tab. Matches the handoff screenshot:
//   1) HEADLINE name + $median sold + range + confidence
//   2) Source badges (GI sales / GI listings / Breeder / +N more)
//   3) Multi-series chart (MultiLineChart)
//   4) Observations count + "See underlying transactions →"
//   5) Blended price — contribution by source (stacked h-bars)
//   6) Key metrics strip (Median ask / Ask→Sold spread / Days / Volume)
import type { ComboDetail } from "@/lib/market/fixtures";
import { sourceMeta } from "@/lib/market/sources";
import ConfidenceBadge from "@/components/market/ConfidenceBadge";
import SourceBadge, { SourceBadgeList } from "@/components/market/SourceBadge";
import MultiLineChart from "@/components/market/charts/MultiLineChart";
import LivePreviewTag, {
  type LivePreviewStatus,
} from "@/components/market/LivePreviewTag";

export default function ComboDetailPanel({
  detail,
  status,
  note,
}: {
  detail: ComboDetail | null;
  status?: LivePreviewStatus;
  note?: string;
}) {
  if (!detail) {
    return (
      <section className="forest-surface flex h-[500px] items-center justify-center p-5 text-sm text-forest-500">
        Select a combo on the left to see detail.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="forest-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wider text-forest-400">
              Headline
            </div>
            <h2 className="mt-0.5 truncate text-xl font-semibold text-forest-50">
              {detail.combo}
            </h2>
            <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className="text-3xl font-semibold tabular-nums text-ready">
                ${detail.medianSold.toLocaleString()}
              </span>
              <span className="text-xs text-forest-400">median sold</span>
              <span className="text-xs text-forest-500">
                range ${detail.range[0].toLocaleString()}–$
                {detail.range[1].toLocaleString()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status ? <LivePreviewTag status={status} note={note} /> : null}
            <ConfidenceBadge score={detail.attribution.confidence.score} size="md" />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {detail.attribution.sources.slice(0, 3).map((id) => (
            <SourceBadge key={id} id={id} size="md" />
          ))}
          {detail.attribution.sources.length > 3 ? (
            <span className="rounded-md border border-forest-700 bg-forest-900/80 px-2 py-1 font-mono text-[10px] text-forest-300">
              +{detail.attribution.sources.length - 3} more
            </span>
          ) : null}
        </div>

        <div className="mt-4">
          <MultiLineChart series={detail.series} />
        </div>

        <footer className="mt-3 text-[11px] text-forest-500">
          <span className="font-mono">
            {detail.observations.toLocaleString()} observations over period
          </span>
        </footer>
      </section>

      <section className="forest-surface p-5">
        <header className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
          >
            ≋
          </span>
          <div>
            <h3 className="text-sm font-semibold text-forest-50">
              Blended price — contribution by source
            </h3>
            <p className="mt-0.5 text-xs text-forest-400">
              How the headline is assembled from multiple feeds
            </p>
          </div>
        </header>
        <div className="mt-3 space-y-2">
          {detail.blend.length === 0 ? (
            <p className="text-xs text-forest-500">No blend data yet.</p>
          ) : (
            detail.blend.map((b) => (
              <div key={b.source}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-2">
                    <SourceBadge id={b.source} size="sm" />
                    <span className="font-mono text-[10px] text-forest-400">
                      n={b.n}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 font-mono">
                    <span className="tabular-nums text-forest-100">
                      ${b.amount.toLocaleString()}
                    </span>
                    <span className="w-8 text-right text-forest-300">{b.pct}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1 w-full rounded bg-forest-850">
                  <div
                    className="h-1 rounded"
                    style={{
                      width: `${b.pct}%`,
                      backgroundColor: sourceMeta(b.source).color,
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
        <p className="mt-3 text-[11px] text-forest-500">
          Blended confidence: {detail.attribution.confidence.score}/100
        </p>
      </section>

      <section className="forest-surface p-5">
        <h3 className="text-sm font-semibold text-forest-50">Key metrics</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Metric label="Median ask" value={`$${detail.keyMetrics.medianAsk.toLocaleString()}`} />
          <Metric
            label="Ask → Sold spread"
            value={`${detail.keyMetrics.askSoldSpreadPct > 0 ? "+" : ""}${detail.keyMetrics.askSoldSpreadPct.toFixed(1)}%`}
            tone={
              Math.abs(detail.keyMetrics.askSoldSpreadPct) < 5
                ? "positive"
                : Math.abs(detail.keyMetrics.askSoldSpreadPct) < 15
                ? "warn"
                : "danger"
            }
          />
          <Metric label="Days to sell" value={`${detail.keyMetrics.daysToSell}d`} />
          <Metric label="Volume in window" value={`${detail.keyMetrics.volume}`} />
        </dl>
        <div className="mt-3">
          <SourceBadgeList ids={detail.attribution.sources} max={4} />
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "warn" | "danger";
}) {
  const cls = {
    neutral: "text-forest-50",
    positive: "text-ready",
    warn: "text-busy",
    danger: "text-danger",
  }[tone];
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-forest-500">
        {label}
      </dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${cls}`}>{value}</dd>
    </div>
  );
}
