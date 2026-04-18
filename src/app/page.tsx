// Public dashboard. Reads directly from Supabase using the anon key + the
// public-read RLS policies from the migration. No auth required.
import PriceHistogram, {
  type Listing,
} from "@/components/charts/PriceHistogram";
import TraitFrequencyAndPrice, {
  type TraitInput,
} from "@/components/charts/TraitFrequencyAndPrice";
import SellerLeaderboardScatter, {
  type Seller,
} from "@/components/charts/SellerLeaderboardScatter";
import { createClient } from "@/lib/supabase/server";

// Always re-fetch on the server (no caching) so the dashboard reflects
// the latest data after an upload. For heavy traffic you'd add ISR + a
// revalidate webhook — overkill for v1.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();

  // Listings: pull everything we need for both the histogram and the trait chart
  // in a single query (column projection keeps the payload tiny).
  const { data: listings, error: listingsError } = await supabase
    .from("market_listings")
    .select(
      "id, price, price_usd_equivalent, maturity, sex, cached_traits, norm_traits",
    );

  const { data: sellers, error: sellersError } = await supabase
    .from("market_sellers")
    .select(
      "seller_id, seller_name, seller_location, membership, feedback_count, seller_rating_score, total_listings, avg_price, five_star_rating",
    );

  if (listingsError || sellersError) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-800">
        <p className="font-semibold">Could not load data from Supabase.</p>
        <pre className="mt-2 whitespace-pre-wrap text-xs">
          {listingsError?.message || sellersError?.message}
        </pre>
        <p className="mt-2 text-sm">
          Check that <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set, and that the SQL
          migration in <code>supabase/migrations/</code> has been applied.
        </p>
      </div>
    );
  }

  const rowsL = (listings ?? []) as Listing[] & TraitInput[];
  const rowsS = (sellers ?? []) as Seller[];

  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-3xl font-semibold text-gecko-dark">Market pulse</h1>
        <p className="mt-1 text-neutral-600">
          {rowsL.length.toLocaleString()} listings · {rowsS.length.toLocaleString()}{" "}
          sellers · refreshed live from Supabase.
        </p>
      </header>

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
