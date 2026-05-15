// Public landing — market-intelligence first impression for a paying client.
// Server component: fetches the snapshot, hands it to four panels. Every
// number resolves to a deep-link into the relevant power-user surface
// (/market, /sellers, /trends) so the page is a launchpad, not a dead end.
//
// The operator's "Sessions in last 7 days" view that used to live here has
// moved to /status (ingest health and freshness), which is where it
// actually belongs.
import HeroBand from "@/components/landing/HeroBand";
import WhatsHotPanel from "@/components/landing/WhatsHotPanel";
import OpportunitiesPanel from "@/components/landing/OpportunitiesPanel";
import TopSellersPanel from "@/components/landing/TopSellersPanel";
import DeepDiveCta from "@/components/landing/DeepDiveCta";
import ScrollytellingSection from "@/components/landing/ScrollytellingSection";
import { LandingFiltersProvider } from "@/components/landing/LandingFilters";
import FilterChips from "@/components/landing/FilterChips";
import PriceBandSlider from "@/components/landing/PriceBandSlider";
import ComboFilter from "@/components/landing/ComboFilter";
import SectionOrnament from "@/components/ui/SectionOrnament";
import {
  getComboDailyAppearances,
  getMarketSnapshot,
} from "@/lib/landing/snapshot";
import { getScrollytellingData } from "@/lib/landing/scrollytelling";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const [snapshot, scrolly] = await Promise.all([
    getMarketSnapshot(),
    getScrollytellingData(),
  ]);
  // Combo-level chronological data: 14-day appearance counts per combo,
  // computed off market_listings.first_seen_at so the WhatsHotPanel
  // sparklines reflect actual day-by-day discovery, not synthetic
  // deltas. Done after the snapshot returns so the combo list is
  // available; cheap enough at this scale that the extra serial round
  // trip is acceptable.
  const comboDaily = await getComboDailyAppearances(
    snapshot.combos.slice(0, 12),
  );

  return (
    <LandingFiltersProvider>
      <div className="page-rise space-y-12">
        <HeroBand snapshot={snapshot} />

        <FilterChips />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ComboFilter allCombos={snapshot.combos.map((c) => c.combo_name)} />
          <PriceBandSlider
            maxPrice={Math.max(
              snapshot.totals.p75_price ? snapshot.totals.p75_price * 4 : 2500,
              2500,
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <WhatsHotPanel combos={snapshot.combos} comboDaily={comboDaily} />
          </div>
          <div className="lg:col-span-2">
            <OpportunitiesPanel opportunities={snapshot.opportunities} />
          </div>
        </div>

        <TopSellersPanel sellers={snapshot.top_sellers} />

        <SectionOrnament variant="leaf" />

        <ScrollytellingSection data={scrolly} />

        <SectionOrnament variant="diamond" />

        <DeepDiveCta />
      </div>
    </LandingFiltersProvider>
  );
}
