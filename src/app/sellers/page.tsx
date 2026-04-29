// Seller leaderboard index. Charts (scatter / bubble / treemap / geo) are
// driven by the registry + user prefs through <ChartGrid>; the table below
// stays page-owned because it's the navigational entry point.
import Link from "next/link";
import { type Seller } from "@/components/charts/SellerLeaderboardScatter";
import ChartGrid from "@/components/charts/ChartGrid";
import DataTable, { type Column } from "@/components/ui/DataTable";
import KpiCard from "@/components/ui/KpiCard";
import { SectionHeader } from "@/components/ui/Panel";
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
      <div className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
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
          className="font-medium text-claude hover:underline"
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
      <SectionHeader
        eyebrow="Directory"
        title="Sellers"
        description={`${fmtInt(rows.length)} tracked sellers. Click a name to see their timeline.`}
      />

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

      <ChartGrid page="sellers" ctx={{ sellers: rows }} />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink-50">All sellers</h2>
        <DataTable columns={columns} rows={rows} rowKey={(s) => s.seller_id} />
      </section>
    </div>
  );
}
