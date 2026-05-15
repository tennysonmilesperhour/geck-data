"use client";
// 4-up small multiples sitting below the headline Market Index. Each
// tile shows one anchor-morph sub-index (Lilly White / Harlequin /
// Axanthic / Cappuccino) at a glance: current value, delta over the
// window, a compact area chart, and a click-through that filters the
// dashboard to that combo.
//
// This is the "small multiples" idiom from Tufte / Bloomberg sector
// boards: same shape across multiple series so the viewer's eye can
// compare slopes without rescaling between cards.
import { AreaChart } from "@/components/market/charts/InlineCharts";
import LivePreviewTag, {
  type LivePreviewStatus,
} from "@/components/market/LivePreviewTag";
import type { MarketSubIndex } from "@/lib/market/fixtures";

export default function MarketSubIndices({
  data,
  onSelectCombo,
  status,
  note,
}: {
  data: ReadonlyArray<MarketSubIndex>;
  onSelectCombo?: (combo: string) => void;
  status?: LivePreviewStatus;
  note?: string;
}) {
  if (data.length === 0) return null;

  return (
    <section className="forest-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-[16px] font-medium tracking-tight text-forest-50">
            Anchor morph indices
          </h3>
          <p className="mt-0.5 text-xs text-forest-400">
            The four high-volume morphs that drive the basket index, each
            with its own slope. Compare across to see which family is
            carrying the market and which is dragging.
          </p>
        </div>
        {status ? <LivePreviewTag status={status} note={note} /> : null}
      </header>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.map((sub) => {
          const positive = sub.deltaPct >= 0;
          const deltaColor = positive ? "text-ready" : "text-danger";
          const arrow = positive ? "▲" : "▼";
          const lineColor = positive ? "#7bbf83" : "#d76d62";
          return (
            <button
              key={sub.morph}
              type="button"
              onClick={
                onSelectCombo ? () => onSelectCombo(sub.morph) : undefined
              }
              className="forest-surface-soft group rounded-lg p-3 text-left transition hover:border-ready/40"
              title={`Open ${sub.morph} in the Combos tab`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-forest-300">
                  {sub.morph}
                </span>
                <span
                  className={`flex items-center gap-1 font-mono text-[11px] tabular-nums ${deltaColor}`}
                >
                  <span>{arrow}</span>
                  <span>{Math.abs(sub.deltaPct).toFixed(1)}%</span>
                </span>
              </div>
              <div className="mt-1 font-display text-[22px] font-medium tabular-nums text-forest-50">
                {sub.value.toLocaleString()}
              </div>
              <div className="-mx-1 mt-1">
                <AreaChart
                  data={sub.series}
                  color={lineColor}
                  tooltipLabel={sub.morph}
                  height={70}
                />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
