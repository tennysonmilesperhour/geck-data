// /market — Market Analytics dashboard. Public route; reads deterministic
// fixtures today, swapping to Supabase queries per-widget as pipelines land
// behind the same source-attribution interface.
import MarketDashboard from "@/components/market/MarketDashboard";
import { SectionHeader, StatusPill } from "@/components/ui/Panel";

export const dynamic = "force-dynamic";

export default function MarketPage() {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Analysis · Market"
        title="Geck Inspect Market"
        description="Weighted pricing, movers, regional spreads, arbitrage, and forward supply — every number tagged with its source and confidence."
        right={<StatusPill status="info" label="Preview" />}
      />
      <MarketDashboard />
    </div>
  );
}
