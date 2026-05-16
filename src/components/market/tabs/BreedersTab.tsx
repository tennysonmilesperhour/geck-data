"use client";
// Breeders tab. Screenshots didn't detail this body; designed to answer
// "whose listings should I watch?" — who's shipping volume, at what
// price, over what lineage, with what recent velocity.
//
// KPI strip (breeders tracked / top region / avg sold price / avg days)
// + ranked table with a per-row 12-week velocity sparkline, specialty
// combo, and a lineage score pill.
import type { Filters } from "@/lib/market/types";
import { fetchBreeders } from "@/lib/market/queries";
import { useFilteredQuery } from "@/lib/market/useFilteredQuery";
import EmptyState from "@/components/market/EmptyState";
import KpiCard from "@/components/ui/KpiCard";
import ConfidenceBadge from "@/components/market/ConfidenceBadge";
import LivePreviewTag from "@/components/market/LivePreviewTag";
import MiniSparkline from "@/components/charts/MiniSparkline";

export default function BreedersTab({
  filters,
  onSelectCombo,
}: {
  filters: Filters;
  onSelectCombo?: (combo: string) => void;
}) {
  const q = useFilteredQuery(fetchBreeders, filters, [] as const);
  if (!q.data) {
    return (
      <EmptyState
        status={q.status}
        label="Breeders"
        note={q.note}
      />
    );
  }
  const data = q.data;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Breeders tracked"
          value={data.kpis.totalBreeders.toLocaleString()}
        />
        <KpiCard label="Top region" value={data.kpis.topRegion} tone="info" />
        <KpiCard
          label="Avg sold price"
          value={`$${data.kpis.avgSoldPrice.toLocaleString()}`}
          tone="positive"
        />
        <KpiCard
          label="Avg days to sell"
          value={`${data.kpis.avgDaysToSell}d`}
        />
      </section>

      <section className="forest-surface">
        <header className="flex items-start justify-between gap-3 border-b border-forest-700/70 p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
            >
              ☰
            </span>
            <div>
              <h2 className="font-display text-[18px] font-medium tracking-tight text-forest-50">Breeders</h2>
              <p className="mt-0.5 max-w-lg text-xs text-forest-400">
                Ranked by sold volume in the selected window. Sparkline shows
                the last 12 weeks of new listings. Click a specialty combo to
                jump into Combos detail.
              </p>
            </div>
          </div>
          <LivePreviewTag status={q.status} note={q.note} />
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.14em] text-forest-400">
                <th className="px-3 py-2">Breeder</th>
                <th className="px-3 py-2">Region</th>
                <th className="px-3 py-2 text-right">Active</th>
                <th className="px-3 py-2 text-right">Sold</th>
                <th className="px-3 py-2 text-right">Avg price</th>
                <th className="px-3 py-2 text-right">Days</th>
                <th className="px-3 py-2">12w velocity</th>
                <th className="px-3 py-2">Specialty</th>
                <th className="px-3 py-2 text-right">Lineage</th>
                <th className="px-3 py-2 text-right">Conf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-700/60">
              {data.rows.map((r) => (
                <tr key={r.name} className="row-hover">
                  <td className="px-3 py-3 align-middle font-medium text-forest-50">
                    {r.name}
                  </td>
                  <td className="px-3 py-3 align-middle font-mono text-[11px] text-forest-300">
                    {r.region}
                  </td>
                  <td className="px-3 py-3 text-right align-middle font-mono tabular-nums text-forest-200">
                    {r.activeListings}
                  </td>
                  <td className="px-3 py-3 text-right align-middle font-mono tabular-nums text-ready">
                    {r.soldInWindow}
                  </td>
                  <td className="px-3 py-3 text-right align-middle font-mono tabular-nums text-forest-100">
                    ${r.avgSoldPrice.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right align-middle font-mono tabular-nums text-forest-200">
                    {r.avgDaysToSell}d
                  </td>
                  <td className="px-3 py-3 align-middle">
                    {r.velocity.length > 0 ? (
                      <MiniSparkline
                        values={r.velocity}
                        width={84}
                        height={20}
                      />
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-forest-700 bg-forest-950/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-forest-500">
                        coming soon
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    {r.specialty && (r.specialty as string) !== "—" ? (
                      <button
                        type="button"
                        onClick={
                          onSelectCombo ? () => onSelectCombo(r.specialty) : undefined
                        }
                        className="rounded-md border border-forest-700 bg-forest-950/60 px-2 py-0.5 text-[11px] text-forest-200 hover:border-ready/40 hover:text-ready"
                      >
                        {r.specialty}
                      </button>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-forest-700 bg-forest-950/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-forest-500">
                        coming soon
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right align-middle">
                    <LineagePill score={r.lineageScore} />
                  </td>
                  <td className="px-3 py-3 text-right align-middle">
                    <ConfidenceBadge
                      score={r.attribution.confidence.score}
                      size="sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="border-t border-forest-700/70 p-3 text-[11px] text-forest-500">
          Lineage score blends proven-breeder status, founder provenance, and
          historical close rate. 0..100; anything ≥ 70 is a strong project
          house.
        </footer>
      </section>
    </div>
  );
}

function LineagePill({ score }: { score: number }) {
  const tone =
    score >= 70
      ? "border-ready/40 bg-ready/10 text-ready"
      : score >= 45
      ? "border-busy/40 bg-busy/10 text-busy"
      : "border-forest-700 bg-forest-950/60 text-forest-300";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${tone}`}
    >
      <span aria-hidden>⬢</span>
      {score}
    </span>
  );
}
