// Seller directory. Editorial header + featured top-six + location
// distribution + the full ranked table. Charts (scatter / bubble /
// treemap / geo) stay driven by ChartGrid; the table below is page-
// owned because it's the navigational entry point.
import Link from "next/link";
import { type Seller } from "@/components/charts/SellerLeaderboardScatter";
import ChartGrid from "@/components/charts/ChartGrid";
import DataTable, { type Column } from "@/components/ui/DataTable";
import KpiCard from "@/components/ui/KpiCard";
import { SectionHeader } from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtUsd } from "@/lib/format";
import FeaturedSellerCard, {
  type FeaturedSeller,
} from "@/components/sellers/FeaturedSellerCard";
import LocationDistribution from "@/components/sellers/LocationDistribution";
import SellerInitials from "@/components/sellers/SellerInitials";
import MiniSparkline from "@/components/charts/MiniSparkline";
import DataFreshness from "@/components/ui/DataFreshness";
import { getSellerDailyActivity } from "@/lib/sellers/activity";
import { parseFilters } from "@/lib/filters/link";
import { HIGH_VALUE_COMBOS } from "@/lib/market/combos";

export const dynamic = "force-dynamic";

type SellerRow = Seller & {
  total_listings: number | null;
  avg_price: number | null;
  seller_rating_score: number | null;
};

export default async function SellersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const filters = parseFilters(searchParams);
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

  let rows = (data ?? []) as SellerRow[];

  // When the user arrived here from a combo entity page (or any link
  // that passed &combos=...), narrow to sellers who currently list at
  // least one matching listing. Best-effort: we query a counts-per-
  // seller view scoped to combo trait tokens. If any combo slug is
  // unknown, it is silently skipped rather than failing the whole
  // page; a partial filter is still useful.
  const focusedCombos = filters.combos
    .map((slug) => HIGH_VALUE_COMBOS.find((c) => c.id === slug))
    .filter((c): c is (typeof HIGH_VALUE_COMBOS)[number] => Boolean(c));

  let filterSummary: string | null = null;
  if (focusedCombos.length > 0) {
    const sellerIds = new Set<string>();
    for (const combo of focusedCombos) {
      let q = supabase
        .from("market_listings")
        .select("seller_id")
        .eq("current_status", "live")
        .not("seller_id", "is", null)
        .limit(5000);
      for (const t of combo.traits) {
        q = q.ilike("cached_traits", `%${t}%`);
      }
      const { data: matches } = await q;
      for (const m of (matches ?? []) as Array<{ seller_id: string | null }>) {
        if (m.seller_id) sellerIds.add(m.seller_id);
      }
    }
    rows = rows.filter((r) => sellerIds.has(r.seller_id));
    filterSummary = `Filtered to sellers carrying ${focusedCombos.map((c) => c.display).join(" or ")}`;
  }
  const totalInv = rows.reduce((a, r) => a + (r.total_listings ?? 0), 0);
  const avgPriceAll =
    rows.reduce((a, r) => a + (r.avg_price ?? 0) * (r.total_listings ?? 0), 0) /
    Math.max(1, totalInv);
  const featured = rows.slice(0, 6) as FeaturedSeller[];

  // Chronological per-seller activity for the top ~60 (covers the
  // featured cards + visible table window). Limiting to a known set
  // keeps the query bounded; sellers off the top of the list render
  // without a sparkline rather than burning a query.
  const sparkTargetIds = rows.slice(0, 60).map((r) => r.seller_id);
  const sellerActivity = await getSellerDailyActivity(sparkTargetIds);

  const columns: Column<SellerRow>[] = [
    {
      key: "name",
      header: "Seller",
      render: (s) => (
        <Link
          href={`/sellers/${s.seller_id}`}
          className="group inline-flex items-center gap-3"
        >
          <SellerInitials name={s.seller_name ?? s.seller_id} size={28} />
          <span className="font-medium text-ink-100 transition group-hover:text-claude-glow">
            {s.seller_name ?? s.seller_id}
          </span>
        </Link>
      ),
    },
    { key: "loc", header: "Location", render: (s) => s.seller_location ?? "—" },
    {
      key: "activity",
      header: "30d",
      render: (s) => {
        const daily = sellerActivity.get(s.seller_id);
        if (!daily || daily.every((v) => v === 0)) {
          return <span className="text-ink-600">—</span>;
        }
        return (
          <span className="hidden sm:inline-block">
            <MiniSparkline values={daily} width={80} height={20} />
          </span>
        );
      },
    },
    { key: "mem", header: "Plan", render: (s) => s.membership ?? "—" },
    {
      key: "listings",
      header: "Listings",
      align: "right",
      render: (s) => (
        <span className="font-mono tabular-nums">{fmtInt(s.total_listings)}</span>
      ),
    },
    {
      key: "avg",
      header: "Avg price",
      align: "right",
      render: (s) => (
        <span className="font-mono tabular-nums">{fmtUsd(s.avg_price)}</span>
      ),
    },
    {
      key: "fb",
      header: "Feedback",
      align: "right",
      render: (s) => (
        <span className="font-mono tabular-nums text-ink-300">
          {fmtInt(s.feedback_count)}
        </span>
      ),
    },
    {
      key: "rating",
      header: "Rating",
      align: "right",
      render: (s) =>
        s.seller_rating_score != null ? (
          <span className="font-mono tabular-nums">
            {s.seller_rating_score.toFixed(2)}
          </span>
        ) : (
          <span className="text-ink-500">—</span>
        ),
    },
  ];

  return (
    <div className="page-rise space-y-10">
      <SectionHeader
        eyebrow="Directory"
        title="Every breeder, ranked"
        description={
          filterSummary
            ? `${filterSummary}. ${fmtInt(rows.length)} sellers match.`
            : `${fmtInt(rows.length)} sellers tracked across the catalog. The top six are spotlighted below; the rest are sortable in the table. Click any name for their full history.`
        }
        right={<DataFreshness updatedAt={Date.now()} window="30 days" />}
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

      {featured.length > 0 ? (
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-display text-[22px] font-medium tracking-tight text-ink-50">
              Featured breeders
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-500">
              ranked by inventory
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {featured.map((s) => (
              <FeaturedSellerCard
                key={s.seller_id}
                seller={s}
                daily={sellerActivity.get(s.seller_id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartGrid page="sellers" ctx={{ sellers: rows }} />
        </div>
        <LocationDistribution rows={rows} />
      </div>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-[22px] font-medium tracking-tight text-ink-50">
            All sellers
          </h2>
          <span className="text-xs text-ink-400">
            {fmtInt(rows.length)} rows
          </span>
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(s) => s.seller_id} />
      </section>
    </div>
  );
}
