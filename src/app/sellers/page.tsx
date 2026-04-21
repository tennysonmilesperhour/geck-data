// Seller leaderboard index. Reuses the existing scatter chart and adds a
// sortable/linkable table below.
import Link from "next/link";
import SellerLeaderboardScatter, {
  type Seller,
} from "@/components/charts/SellerLeaderboardScatter";
import DataTable, { type Column } from "@/components/ui/DataTable";
import KpiCard from "@/components/ui/KpiCard";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

type SellerRow = Seller & { total_listings: number | null; avg_price: number | null };

export default async function SellersPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("market_sellers")
    .select(
      "seller_id, seller_name, seller_location, membership, feedback_count, seller_rating_score, total_listings, avg_price, five_star_rating",
    )
    .order("total_listings", { ascending: false, nullsFirst: false })
    .limit(1000);

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-800">
        Failed to load sellers: {error.message}
      </div>
    );
  }

  const rows = (data ?? []) as SellerRow[];
  const totalInv = rows.reduce((a, r) => a + (r.total_listings ?? 0), 0);
  const avgPriceAll =
    rows.reduce((a, r) => a + (r.avg_price ?? 0) * (r.total_listings ?? 0), 0) /
    Math.max(1, totalInv);

  const columns: Column<SellerRow>[] = [
    {
      key: "name",
      header: "Seller",
      render: (s) => (
        <Link
          href={`/sellers/${s.seller_id}`}
          className="font-medium text-gecko hover:underline"
        >
          {s.seller_name ?? s.seller_id}
        </Link>
      ),
    },
    { key: "loc", header: "Location", render: (s) => s.seller_location ?? "—" },
    { key: "mem", header: "Plan", render: (s) => s.membership ?? "—" },
    {
      key: "listings",
      header: "Listings",
      align: "right",
      render: (s) => fmtInt(s.total_listings),
    },
    {
      key: "avg",
      header: "Avg price",
      align: "right",
      render: (s) => fmtUsd(s.avg_price),
    },
    {
      key: "fb",
      header: "Feedback",
      align: "right",
      render: (s) => fmtInt(s.feedback_count),
    },
    {
      key: "rating",
      header: "Rating",
      align: "right",
      render: (s) =>
        s.seller_rating_score != null ? s.seller_rating_score.toFixed(2) : "—",
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-gecko-dark">Sellers</h1>
        <p className="mt-1 text-neutral-600">
          {fmtInt(rows.length)} tracked sellers. Click a name to see their
          timeline.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Sellers" value={rows.length} />
        <KpiCard label="Combined inventory" value={fmtInt(totalInv)} />
        <KpiCard label="Market avg price" value={fmtUsd(avgPriceAll)} />
        <KpiCard
          label="Top seller"
          value={rows[0]?.seller_name ?? "—"}
          sub={rows[0] ? `${fmtInt(rows[0].total_listings)} listings` : undefined}
        />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Leaderboard scatter</h2>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <SellerLeaderboardScatter data={rows} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">All sellers</h2>
        <DataTable columns={columns} rows={rows} rowKey={(s) => s.seller_id} />
      </section>
    </div>
  );
}
