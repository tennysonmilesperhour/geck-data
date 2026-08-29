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
import BelowCompsPanel from "@/components/landing/BelowCompsPanel";
import TopSellersPanel from "@/components/landing/TopSellersPanel";
import DeepDiveCta from "@/components/landing/DeepDiveCta";
import ScrollytellingSection from "@/components/landing/ScrollytellingSection";
import { LandingFiltersProvider } from "@/components/landing/LandingFilters";
import FilterChips from "@/components/landing/FilterChips";
import PriceBandSlider from "@/components/landing/PriceBandSlider";
import ComboFilter from "@/components/landing/ComboFilter";
import SectionOrnament from "@/components/ui/SectionOrnament";
import AnchorIndicesStrip from "@/components/landing/AnchorIndicesStrip";
import BrowseStrip from "@/components/landing/BrowseStrip";
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
  // Combo-level chronological data: 14-day appearance counts per combo, so
  // the WhatsHotPanel sparklines show real arrivals rather than synthetic
  // deltas. Bucketed on first_listed_at, the date MorphMarket says the animal
  // went up, and only on first_seen_at where no list date exists. The
  // distinction is not cosmetic: first_seen_at is when our ingest ran, and
  // under a weekly pass it collapses a whole week of arrivals onto one day.
  // Done after the snapshot returns so the combo list is available; cheap
  // enough at this scale that the extra serial round trip is acceptable.
  const comboDaily = await getComboDailyAppearances(
    snapshot.combos.slice(0, 12),
  );

  return (
    <LandingFiltersProvider>
      <div className="page-rise space-y-12">
        <HeroBand snapshot={snapshot} />

        <BrowseStrip />

        <AnchorIndicesStrip />

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
            <BelowCompsPanel listings={snapshot.below_comps} />
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
