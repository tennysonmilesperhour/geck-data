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
import { getMarketSnapshot } from "@/lib/landing/snapshot";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const snapshot = await getMarketSnapshot();

  return (
    <div className="space-y-8">
      <HeroBand snapshot={snapshot} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <WhatsHotPanel combos={snapshot.combos} />
        </div>
        <div className="lg:col-span-2">
          <OpportunitiesPanel opportunities={snapshot.opportunities} />
        </div>
      </div>

      <TopSellersPanel sellers={snapshot.top_sellers} />

      <DeepDiveCta />
    </div>
  );
}
