// One seller's timeline — header KPIs, snapshot trend, current listings,
// recent sold, recent drops.
import Link from "next/link";
import { notFound } from "next/navigation";
import KpiCard from "@/components/ui/KpiCard";
import DataTable, { type Column } from "@/components/ui/DataTable";
import TimeSeriesLine, { type Series } from "@/components/charts/TimeSeriesLine";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtInt, fmtRelative, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

type SellerDetail = {
  seller_id: string;
  seller_name: string | null;
  seller_location: string | null;
  membership: string | null;
  feedback_count: number | null;
  seller_rating_score: number | null;
  total_listings: number | null;
  avg_price: number | null;
};

type ListingRow = {
  id: string;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  maturity: string | null;
  sex: string | null;
  current_status: string | null;
  last_seen_at: string | null;
};

type SnapshotRow = {
  observed_at: string | null;
  feedback_count: number | null;
  total_listings: number | null;
  avg_price: number | null;
};

type SoldRow = {
  id: string;
  title: string | null;
  price_usd_equivalent: number | null;
  price: number | null;
  sold_at: string | null;
  days_to_sell: number | null;
};

export default async function SellerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const sellerId = params.id;

  const [sellerRes, listingsRes, snapshotsRes, soldRes] = await Promise.all([
    supabase
      .from("market_sellers")
      .select(
        "seller_id, seller_name, seller_location, membership, feedback_count, seller_rating_score, total_listings, avg_price",
      )
      .eq("seller_id", sellerId)
      .maybeSingle(),
    supabase
      .from("market_listings")
      .select(
        "id, title, price, price_usd_equivalent, maturity, sex, current_status, last_seen_at",
      )
      .eq("seller_id", sellerId)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(500),
    supabase
      .from("seller_snapshots")
      .select("observed_at, feedback_count, total_listings, avg_price")
      .eq("seller_id", sellerId)
      .order("observed_at", { ascending: true })
      .limit(500),
    supabase
      .from("sold_listings_v")
      .select("id, title, price_usd_equivalent, price, sold_at, days_to_sell")
      .eq("seller_id", sellerId)
      .order("sold_at", { ascending: false })
      .limit(100),
  ]);

  if (sellerRes.error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-800">
        Failed to load seller: {sellerRes.error.message}
      </div>
    );
  }
  if (!sellerRes.data) notFound();

  const seller = sellerRes.data as SellerDetail;
  const listings = (listingsRes.data ?? []) as ListingRow[];
  const snapshots = (snapshotsRes.data ?? []) as SnapshotRow[];
  const sold = (soldRes.data ?? []) as SoldRow[];

  const feedbackSeries: Series = {
    name: "feedback",
    color: "#2f7d32",
    points: snapshots
      .filter((s) => s.observed_at && typeof s.feedback_count === "number")
      .map((s) => ({ t: new Date(s.observed_at!), v: s.feedback_count! })),
  };
  const listingsSeries: Series = {
    name: "listings",
    color: "#f57c00",
    points: snapshots
      .filter((s) => s.observed_at && typeof s.total_listings === "number")
      .map((s) => ({ t: new Date(s.observed_at!), v: s.total_listings! })),
  };

  const liveCount = listings.filter((l) => l.current_status === "live").length;
  const soldCount = sold.length;
  const medianDays = median(sold.map((s) => s.days_to_sell));

  const listingColumns: Column<ListingRow>[] = [
    {
      key: "title",
      header: "Listing",
      render: (r) => (
        <div>
          <div className="font-medium">{r.title ?? r.id}</div>
          <div className="text-xs text-neutral-500">{r.id}</div>
        </div>
      ),
    },
    { key: "maturity", header: "Maturity", render: (r) => r.maturity ?? "—" },
    { key: "sex", header: "Sex", render: (r) => r.sex ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${
            r.current_status === "sold"
              ? "bg-neutral-200 text-neutral-700"
              : r.current_status === "live"
                ? "bg-gecko/10 text-gecko-dark"
                : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {r.current_status ?? "—"}
        </span>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (r) => fmtUsd(r.price_usd_equivalent ?? r.price),
    },
    {
      key: "last_seen",
      header: "Last seen",
      render: (r) => fmtRelative(r.last_seen_at),
    },
  ];

  const soldColumns: Column<SoldRow>[] = [
    {
      key: "title",
      header: "Listing",
      render: (r) => r.title ?? r.id,
    },
    {
      key: "price",
      header: "Sold price",
      align: "right",
      render: (r) => fmtUsd(r.price_usd_equivalent ?? r.price),
    },
    {
      key: "days",
      header: "Days",
      align: "right",
      render: (r) => fmtInt(r.days_to_sell),
    },
    { key: "when", header: "Sold", render: (r) => fmtDate(r.sold_at) },
  ];

  return (
    <div className="space-y-8">
      <header>
        <Link href="/sellers" className="text-sm text-gecko hover:underline">
          ← All sellers
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-gecko-dark">
          {seller.seller_name ?? seller.seller_id}
        </h1>
        <p className="mt-1 text-neutral-600">
          {[seller.seller_location, seller.membership].filter(Boolean).join(" · ") ||
            "—"}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Live listings" value={liveCount} tone="positive" />
        <KpiCard label="Sold tracked" value={soldCount} />
        <KpiCard
          label="Median days-to-sell"
          value={medianDays != null ? `${Math.round(medianDays)} d` : "—"}
        />
        <KpiCard label="Feedback" value={fmtInt(seller.feedback_count)} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Snapshot trend</h2>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          {snapshots.length >= 2 ? (
            <TimeSeriesLine series={[feedbackSeries, listingsSeries]} yLabel="count" />
          ) : (
            <p className="py-6 text-center text-sm text-neutral-500">
              Not enough snapshots yet. The extension will build this up as you
              revisit this seller.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Current & recent listings</h2>
        <DataTable
          columns={listingColumns}
          rows={listings}
          rowKey={(r) => r.id}
          emptyMessage="No listings linked to this seller yet."
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recently sold</h2>
        <DataTable
          columns={soldColumns}
          rows={sold}
          rowKey={(r) => r.id}
          emptyMessage="No sold events linked to this seller yet."
        />
      </section>
    </div>
  );
}

function median(vals: (number | null | undefined)[]): number | null {
  const clean = vals
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid];
}
