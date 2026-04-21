// Public dashboard — top-level analytics overview. Reads directly from
// Supabase using the anon key + the public-read RLS policies. KPI strip at
// the top summarises activity across every extension stream; the three
// original D3 charts follow.
import PriceHistogram, {
  type Listing,
} from "@/components/charts/PriceHistogram";
import TraitFrequencyAndPrice, {
  type TraitInput,
} from "@/components/charts/TraitFrequencyAndPrice";
import SellerLeaderboardScatter, {
  type Seller,
} from "@/components/charts/SellerLeaderboardScatter";
import KpiCard from "@/components/ui/KpiCard";
import { createClient } from "@/lib/supabase/server";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [
    listingsRes,
    sellersRes,
    dropCount,
    soldCount,
    showCount,
    crossCount,
  ] = await Promise.all([
    supabase
      .from("market_listings")
      .select(
        "id, price, price_usd_equivalent, maturity, sex, cached_traits, norm_traits",
      ),
    supabase
      .from("market_sellers")
      .select(
        "seller_id, seller_name, seller_location, membership, feedback_count, seller_rating_score, total_listings, avg_price, five_star_rating",
      ),
    supabase
      .from("price_drops")
      .select("id", { count: "exact", head: true })
      .gte("observed_at", sevenDaysAgo),
    supabase
      .from("listing_status_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "sold")
      .gte("observed_at", sevenDaysAgo),
    supabase
      .from("show_mentions")
      .select("id", { count: "exact", head: true })
      .gte("observed_at", sevenDaysAgo),
    supabase
      .from("cross_platform_listings")
      .select("id", { count: "exact", head: true })
      .gte("last_seen_at", sevenDaysAgo),
  ]);

  if (listingsRes.error || sellersRes.error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-800">
        <p className="font-semibold">Could not load data from Supabase.</p>
        <pre className="mt-2 whitespace-pre-wrap text-xs">
          {listingsRes.error?.message || sellersRes.error?.message}
        </pre>
        <p className="mt-2 text-sm">
          Check that <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set, and that the SQL
          migrations in <code>supabase/migrations/</code> have been applied.
        </p>
      </div>
    );
  }

  const rowsL = (listingsRes.data ?? []) as Listing[] & TraitInput[];
  const rowsS = (sellersRes.data ?? []) as Seller[];

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold text-gecko-dark">Market pulse</h1>
        <p className="mt-1 text-neutral-600">
          {fmtInt(rowsL.length)} listings · {fmtInt(rowsS.length)} sellers · refreshed live
          from Supabase.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Past 7 days</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Price drops" value={fmtInt(dropCount.count ?? 0)} tone="warn" />
          <KpiCard label="Sold" value={fmtInt(soldCount.count ?? 0)} tone="positive" />
          <KpiCard label="Show mentions" value={fmtInt(showCount.count ?? 0)} />
          <KpiCard label="Cross-platform updates" value={fmtInt(crossCount.count ?? 0)} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Price distribution</h2>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <PriceHistogram data={rowsL as Listing[]} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">
          Trait frequency &amp; median price
        </h2>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <TraitFrequencyAndPrice data={rowsL as TraitInput[]} topN={25} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Seller leaderboard</h2>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <SellerLeaderboardScatter data={rowsS} />
        </div>
      </section>
    </div>
  );
}
