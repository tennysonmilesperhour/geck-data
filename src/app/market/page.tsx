// /market — Market Analytics dashboard. Each widget reads real Supabase
// data via src/lib/market/queries.ts and renders an EmptyState when its
// underlying view returns no rows. The per-widget LivePreviewTag pill
// is the single source of truth for whether a panel is showing real
// vs preview data — there's no page-level "Live" badge because the
// dashboard is a composite and individual widgets can be in different
// states at any given time.
//
// Scoped theme: the `.market-theme` class in globals.css paints the
// green-tinted atmospheric background and exposes `.forest-surface`
// for per-panel styling. Containing it to this route keeps the rest
// of the app on the neutral slate theme.
import MarketDashboard from "@/components/market/MarketDashboard";

export const dynamic = "force-dynamic";

export default function MarketPage() {
  return (
    <div className="market-theme page-rise space-y-6">
      <div className="space-y-6">
        <header className="grid grid-cols-1 items-end gap-5 border-b border-ink-700/80 pb-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.45fr)]">
          <div className="max-w-3xl">
            <div className="mb-2 inline-flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-clay-300">
              Analysis / Market
            </div>
            <h1 className="font-display text-[38px] font-semibold leading-[1.02] tracking-[-0.04em] text-forest-50 md:text-[52px]">
              Market analytics
            </h1>
            <p className="mt-3 text-[15px] leading-6 text-forest-300">
              Pricing, supply, regional differences, and listing movement with source and confidence context attached to every view.
            </p>
          </div>
          <p className="m-0 border-t border-ink-700 pt-3 font-mono text-[9px] uppercase leading-5 tracking-[0.08em] text-forest-400">
            Use filters to narrow the full dashboard. Asking prices and completed sales remain separate evidence layers.
          </p>
        </header>
        <MarketDashboard />
      </div>
    </div>
  );
}
