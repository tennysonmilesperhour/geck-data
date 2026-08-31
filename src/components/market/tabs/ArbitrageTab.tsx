"use client";
// Arbitrage tab. Two axes:
//   region  MorphMarket regional heatmap spreads (sold medians)
//   source  Feedle Air USD asks vs MorphMarket live asks, combo-matched
//
// Source-axis copy is ask vs ask on purpose. No "sell into strength".
import { useState } from "react";
import type { Filters } from "@/lib/market/types";
import type { ArbitrageAxis } from "@/lib/market/widget-types";
import { fetchArbitrage } from "@/lib/market/queries";
import { useFilteredQuery } from "@/lib/market/useFilteredQuery";
import EmptyState from "@/components/market/EmptyState";
import KpiCard from "@/components/ui/KpiCard";
import ConfidenceBadge from "@/components/market/ConfidenceBadge";
import LivePreviewTag from "@/components/market/LivePreviewTag";

export default function ArbitrageTab({ filters }: { filters: Filters }) {
  const [axis, setAxis] = useState<ArbitrageAxis>("source");
  const q = useFilteredQuery(fetchArbitrage, filters, [axis] as const, axis);
  if (!q.data) {
    return (
      <div className="space-y-4">
        <AxisToggle axis={axis} onChange={setAxis} />
        <EmptyState
          status={q.status}
          label="Arbitrage spreads"
          note={q.note}
        />
      </div>
    );
  }
  const data = q.data;
  const isSource = data.axis === "source";

  return (
    <div className="space-y-4">
      <AxisToggle axis={axis} onChange={setAxis} />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard
          label="Biggest spread"
          value={`${data.kpis.biggestPct.toFixed(1)}%`}
          tone="positive"
          sub={isSource ? "Feedle Air vs MorphMarket asks" : "between two regions"}
        />
        <KpiCard
          label="Avg spread"
          value={`${data.kpis.avgPct.toFixed(1)}%`}
          tone="info"
          sub={`across ${data.rows.length} pairs`}
        />
        <KpiCard
          label="Spreads of 10% or more"
          value={data.kpis.opportunities.toString()}
          tone={data.kpis.opportunities > 0 ? "warn" : "default"}
          sub={isSource ? "combo medians, n>=3 each side" : "notable gaps in window"}
        />
      </section>

      <section className="forest-surface">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-forest-700/70 p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
            >
              ◎
            </span>
            <div>
              <h2 className="font-display text-[18px] font-medium tracking-tight text-forest-50">
                {isSource
                  ? "Source asks: KR Feedle Air vs US MorphMarket"
                  : "Regional spreads"}
              </h2>
              <p className="mt-0.5 max-w-md text-xs text-forest-400">
                {isSource
                  ? "Median asking price for the same canonical combo on each source. This is not a sold comparison, and Feedle Air is a scheduled import lot rather than a MorphMarket click-buy."
                  : "Where the same combo carries a different asking price from one region to another. Asks, not sales: regional sold prices are too sparse to compare. Only listings whose seller has a mappable location are placed in a region, which today means US and CA. Confidence scores how thin each leg is, and a narrow sample on one side inflates the spread."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LivePreviewTag status={q.status} note={q.note} />
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.14em] text-forest-400">
                <th className="px-3 py-2">Combo</th>
                <th className="px-3 py-2">{isSource ? "Lower ask" : "Buy"}</th>
                <th className="px-3 py-2">{isSource ? "Higher ask" : "Sell"}</th>
                <th className="px-3 py-2 text-right">Spread</th>
                <th className="px-3 py-2 text-right">%</th>
                <th className="px-3 py-2 text-right">Conf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-700/60">
              {data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-xs text-forest-500"
                  >
                    No spreads found in the current filter window.
                  </td>
                </tr>
              ) : (
                data.rows.map((r) => (
                  <tr key={r.combo} className="row-hover">
                    <td className="px-3 py-3">
                      <div className="font-medium text-forest-50">{r.combo}</div>
                      <div className="font-mono text-[10px] text-forest-500">
                        {isSource ? "ask vs ask" : "cross-region"}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Leg
                        tag={isSource ? "ASK" : "BUY"}
                        label={r.low.label}
                        price={r.low.price}
                        n={r.low.n}
                        tone="positive"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Leg
                        tag={isSource ? "ASK" : "SELL"}
                        label={r.high.label}
                        price={r.high.price}
                        n={r.high.n}
                        tone="warn"
                      />
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-forest-100">
                      ${r.spreadAbs.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      <span className={r.spreadPct >= 10 ? "text-ready" : "text-forest-300"}>
                        {r.spreadPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <ConfidenceBadge score={r.attribution.confidence.score} size="sm" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <footer className="border-t border-forest-700/70 p-3 text-[11px] text-forest-500">
          {isSource
            ? q.note ??
              "Ask vs ask. Feedle Air is a scheduled Korea-to-US import lot. MorphMarket live includes catalogue leftovers. Hidden when either side has fewer than 3 listings."
            : "Spreads before shipping, fees, and currency conversion. Treat as a shortlist, not a trade signal."}
        </footer>
      </section>
    </div>
  );
}

function AxisToggle({
  axis,
  onChange,
}: {
  axis: ArbitrageAxis;
  onChange: (axis: ArbitrageAxis) => void;
}) {
  return (
    <div className="forest-surface-soft inline-flex items-center gap-1 p-1">
      {(
        [
          ["source", "By source"],
          ["region", "By region"],
        ] as const
      ).map(([id, label]) => {
        const active = axis === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              active
                ? "border border-ready/50 bg-ready/15 text-ready"
                : "border border-transparent text-forest-300 hover:bg-forest-850 hover:text-forest-100"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Leg({
  tag,
  label,
  price,
  n,
  tone,
}: {
  tag: string;
  label: string;
  price: number;
  n: number;
  tone: "positive" | "warn";
}) {
  const tagColor = tone === "positive" ? "text-ready border-ready/40" : "text-busy border-busy/40";
  return (
    <div className="flex items-center gap-2">
      <span
        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tagColor}`}
      >
        {tag}
      </span>
      <div>
        <div className="text-sm text-forest-100">{label}</div>
        <div className="font-mono text-[10px] text-forest-500">
          ${price.toLocaleString()} · n={n}
        </div>
      </div>
    </div>
  );
}
