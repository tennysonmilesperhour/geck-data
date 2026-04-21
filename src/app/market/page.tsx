// /market — Market Analytics dashboard. Public route; reads deterministic
// fixtures today, swapping to Supabase queries per-widget as pipelines land
// behind the same source-attribution interface.
//
// Scoped theme: the `.market-theme` class in globals.css paints the
// green-tinted atmospheric background (matches handoff screenshots) and
// exposes `.forest-surface` for per-panel styling. Containing it to this
// route keeps the rest of the app on the neutral slate theme.
import MarketDashboard from "@/components/market/MarketDashboard";

export const dynamic = "force-dynamic";

export default function MarketPage() {
  return (
    <div className="market-theme -mx-6 -my-8 min-h-[calc(100vh-4rem)] px-6 py-8">
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-forest-400">
              Analysis · Market
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-forest-50">
              Geck Inspect Market
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-forest-300">
              Weighted pricing, movers, regional spreads, arbitrage, and
              forward supply — every number tagged with its source and
              confidence.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ready/40 bg-ready/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-ready">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ready shadow-[0_0_0_3px_rgba(74,222,128,0.15)]" />
            Preview
          </span>
        </header>
        <MarketDashboard />
      </div>
    </div>
  );
}
