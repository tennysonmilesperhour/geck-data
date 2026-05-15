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
    <div className="market-theme page-rise -mx-6 -my-8 min-h-[calc(100vh-4rem)] px-6 py-8">
      <div className="space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-forest-400">
              <span className="status-dot" />
              Analysis · Market
            </div>
            <h1 className="font-display text-[40px] font-medium leading-[1.05] tracking-[-0.015em] text-forest-50 md:text-[48px]">
              The crested gecko{" "}
              <span className="text-claude-glow">trading floor.</span>
            </h1>
            <p className="mt-3 text-base leading-7 text-forest-300">
              Weighted pricing, movers, regional spreads, arbitrage, and
              forward supply — every number tagged with its source and
              confidence. Built for breeders evaluating production roadmaps
              and pricing decisions.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ready/40 bg-ready/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-ready">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ready shadow-[0_0_0_3px_rgba(74,222,128,0.15)]" />
            Live
          </span>
        </header>
        <MarketDashboard />
      </div>
    </div>
  );
}
