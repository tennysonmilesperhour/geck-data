import AtlasDashboard from "@/components/design-lab/AtlasDashboard";
import WhatsHotPanel from "@/components/landing/WhatsHotPanel";
import BelowCompsPanel from "@/components/landing/BelowCompsPanel";
import TopSellersPanel from "@/components/landing/TopSellersPanel";
import DeepDiveCta from "@/components/landing/DeepDiveCta";
import ExpandableMarketStory from "@/components/landing/ExpandableMarketStory";
import { LandingFiltersProvider } from "@/components/landing/LandingFilters";
import FilterChips from "@/components/landing/FilterChips";
import PriceBandSlider from "@/components/landing/PriceBandSlider";
import ComboFilter from "@/components/landing/ComboFilter";
import AnchorIndicesStrip from "@/components/landing/AnchorIndicesStrip";
import BrowseStrip from "@/components/landing/BrowseStrip";
import PulseWorkspace from "@/components/landing/PulseWorkspace";
import { getAtlasSnapshot } from "@/lib/landing/atlas";
import {
  getComboDailyAppearances,
  getMarketSnapshot,
} from "@/lib/landing/snapshot";

export const dynamic = "force-dynamic";

/**
 * Pulse combines the compact Atlas comparison with the market workspace that
 * preceded it. Atlas is the fast overview; the shared filters, current trait
 * activity, comparable listings, seller context, and deeper study remain
 * available below it and can be reordered or hidden by the user.
 */
export default async function LandingPage() {
  const [atlas, snapshot] = await Promise.all([
    getAtlasSnapshot(),
    getMarketSnapshot(),
  ]);
  const comboDaily = await getComboDailyAppearances(snapshot.combos.slice(0, 12));

  return (
    <LandingFiltersProvider>
      <PulseWorkspace
        snapshot={{
          totals: snapshot.totals,
          hottest_combo: snapshot.hottest_combo,
          generated_at: snapshot.generated_at,
        }}
        sections={{
          controls: (
            <div className="space-y-3">
              <FilterChips />
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <ComboFilter allCombos={snapshot.combos.map((combo) => combo.combo_name)} />
                <PriceBandSlider
                  maxPrice={Math.max(
                    snapshot.totals.p75_price ? snapshot.totals.p75_price * 4 : 2500,
                    2500,
                  )}
                />
              </div>
              <p className="font-mono text-[10px] leading-4 text-ink-500">
                These controls narrow the comparable-listing module. The Atlas orbit is an independent trait-family comparison.
              </p>
            </div>
          ),
          atlas: <AtlasDashboard snapshot={atlas} production compact />,
          signals: <WhatsHotPanel combos={snapshot.combos} comboDaily={comboDaily} limit={6} />,
          opportunities: <BelowCompsPanel listings={snapshot.below_comps} limit={6} />,
          indices: <AnchorIndicesStrip />,
          sellers: <TopSellersPanel sellers={snapshot.top_sellers} />,
          story: <ExpandableMarketStory />,
          explore: <div className="space-y-5"><BrowseStrip /><DeepDiveCta /></div>,
        }}
      />
    </LandingFiltersProvider>
  );
}
