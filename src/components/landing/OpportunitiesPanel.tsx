// Opportunities — live listings priced more than 25% below their combo's
// median ask. The most actionable surface on the landing page: a paying
// client lands here and instantly sees what looks undervalued today.
import { fmtUsd, fmtRelative } from "@/lib/format";
import type { OpportunityListing } from "@/lib/landing/snapshot";

type Props = {
  opportunities: OpportunityListing[];
};

export default function OpportunitiesPanel({ opportunities }: Props) {
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-panel">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-400/80">
            Signal
          </div>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-ink-50">
            Opportunities
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            Listings priced ≥25% below their combo&apos;s median ask. Discount
            is informational, not financial advice.
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
          {opportunities.length} found
        </span>
      </header>

      {opportunities.length === 0 ? (
        <div className="rounded-md border border-ink-700/60 bg-ink-900/40 px-3 py-4 text-sm text-ink-400">
          No listings are currently priced ≥25% below their combo median.
        </div>
      ) : (
        <ul className="space-y-2">
          {opportunities.map((opp) => (
            <li key={opp.id}>
              <a
                href={opp.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start justify-between gap-3 rounded-md border border-ink-700/60 bg-ink-900/40 px-3 py-2.5 transition hover:border-amber-500/40 hover:bg-ink-800/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-100 group-hover:text-amber-100">
                    {opp.title ?? "(no title)"}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-400">
                    {opp.combo_name} · {opp.seller_name ?? "unknown seller"}
                    {opp.seller_location ? ` · ${opp.seller_location}` : ""}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-ink-500">
                    {fmtRelative(opp.first_seen_at)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm tabular-nums text-ink-50">
                    {fmtUsd(opp.price)}
                  </div>
                  <div className="text-xs text-ink-500">
                    vs {opp.combo_median_ask ? fmtUsd(opp.combo_median_ask) : "—"}
                  </div>
                  <div className="mt-0.5 inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-300">
                    −{opp.discount_pct.toFixed(1)}%
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
