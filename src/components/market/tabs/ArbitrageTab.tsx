"use client";
// Arbitrage tab. Pulls the biggest cross-region spreads for each combo
// and surfaces them as a ranked "buy here, sell there" list.
//
// The previous version had a By-source / By-region toggle, but the
// source axis returned fixture data unconditionally because we don't
// yet have multi-source price feeds. That toggle has been dropped
// until the underlying data exists. The fetchArbitrage signature still
// takes an axis arg so adding it back later is a one-line UI change.
import type { Filters } from "@/lib/market/types";
import { fetchArbitrage } from "@/lib/market/queries";
import { useFilteredQuery } from "@/lib/market/useFilteredQuery";
import KpiCard from "@/components/ui/KpiCard";
import ConfidenceBadge from "@/components/market/ConfidenceBadge";
import LivePreviewTag from "@/components/market/LivePreviewTag";

export default function ArbitrageTab({ filters }: { filters: Filters }) {
  const q = useFilteredQuery(fetchArbitrage, filters, ["region"] as const, "region");
  if (!q.data) {
    return (
      <div className="forest-surface p-6 text-sm text-forest-400">
        Loading arbitrage…
      </div>
    );
  }
  const data = q.data;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard
          label="Biggest spread"
          value={`${data.kpis.biggestPct.toFixed(1)}%`}
          tone="positive"
          sub="between two regions"
        />
        <KpiCard
          label="Avg spread"
          value={`${data.kpis.avgPct.toFixed(1)}%`}
          tone="info"
          sub={`across ${data.rows.length} pairs`}
        />
        <KpiCard
          label="Opportunities ≥ 10%"
          value={data.kpis.opportunities.toString()}
          tone={data.kpis.opportunities > 0 ? "warn" : "default"}
          sub="notable mispricings in window"
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
              <h2 className="text-base font-semibold text-forest-50">
                Arbitrage — biggest spreads
              </h2>
              <p className="mt-0.5 max-w-md text-xs text-forest-400">
                Where the same combination is priced meaningfully differently
                across markets. Confidence scores how thin each leg is — a
                narrow sample on one side inflates the spread.
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
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-ready">
                <th className="px-3 py-2">Combo</th>
                <th className="px-3 py-2">Buy</th>
                <th className="px-3 py-2">Sell</th>
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
                  <tr key={r.combo} className="hover:bg-forest-850/50">
                    <td className="px-3 py-3">
                      <div className="font-medium text-forest-50">{r.combo}</div>
                      <div className="font-mono text-[10px] text-forest-500">
                        cross-region
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Leg tag="BUY" label={r.low.label} price={r.low.price} n={r.low.n} tone="positive" />
                    </td>
                    <td className="px-3 py-3">
                      <Leg tag="SELL" label={r.high.label} price={r.high.price} n={r.high.n} tone="warn" />
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
          Spreads before shipping, fees, and currency conversion. Treat as a
          shortlist, not a trade signal.
        </footer>
      </section>
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
