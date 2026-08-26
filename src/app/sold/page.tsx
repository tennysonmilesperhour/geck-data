// Sold listings — static/CDN shell backed by a five-minute cached public
// query. URL filtering happens inside the client dashboard so crawler traffic
// does not turn each query-string variant into another function invocation.
import SoldDashboard from "@/components/sold/SoldDashboard";
import { getSoldPageData } from "@/lib/sold/data";

export const revalidate = 300;

export default async function SoldPage() {
  const { rows, activity, generatedAt, error } = await getSoldPageData();

  if (error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
        Failed to load sold listings: {error}
      </div>
    );
  }

  return (
    <SoldDashboard
      allRows={rows}
      soldActivity={activity}
      generatedAt={generatedAt}
    />
  );
}
