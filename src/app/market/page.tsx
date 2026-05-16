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
        </header>
        <MarketDashboard />
      </div>
    </div>
  );
}
