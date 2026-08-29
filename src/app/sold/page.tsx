// Sold listings, a static/CDN shell backed by a five-minute cached public
// query. URL filtering happens inside the client dashboard so crawler traffic
// does not turn each query-string variant into another function invocation.
//
// The page hands the dashboard two pools rather than one row list: sales the
// pipeline captured, and sales inferred from a listing disappearing. Merging
// them here would put a number on screen that no visitor could interpret.
import SoldDashboard from "@/components/sold/SoldDashboard";
import { getSoldPageData } from "@/lib/sold/data";

export const revalidate = 300;

export default async function SoldPage() {
  const { captured, inferred, activity, generatedAt, error } =
    await getSoldPageData();

  if (error || !captured || !inferred) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
        Failed to load the sold ledger: {error ?? "no pools returned"}
      </div>
    );
  }

  return (
    <SoldDashboard
      captured={captured}
      inferred={inferred}
      soldActivity={activity}
      generatedAt={generatedAt}
    />
  );
}
