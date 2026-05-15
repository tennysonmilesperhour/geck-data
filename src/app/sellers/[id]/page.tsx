// One seller's timeline — header KPIs, snapshot trend, current listings,
// recent sold, recent drops.
import Link from "next/link";
import { notFound } from "next/navigation";
import KpiCard from "@/components/ui/KpiCard";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { Panel, SectionHeader } from "@/components/ui/Panel";
import TimeSeriesLine, {
  type ChartEvent,
  type Series,
} from "@/components/charts/TimeSeriesLine";
import SellerPercentile from "@/components/sellers/SellerPercentile";
import TimeOnMarketHistogram from "@/components/sellers/TimeOnMarketHistogram";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtInt, fmtRelative, fmtUsd } from "@/lib/format";
import WatchButton from "@/components/alerts/WatchButton";

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
  morph_specialization: string | null;
  five_star_rating: number | null;
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

  const [
    sellerRes,
    listingsRes,
    snapshotsRes,
    soldRes,
    marketSellerMediansRes,
    marketDaysToSellRes,
  ] = await Promise.all([
    supabase
      .from("market_sellers")
      .select(
        "seller_id, seller_name, seller_location, membership, feedback_count, seller_rating_score, total_listings, avg_price, morph_specialization, five_star_rating",
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
    // Reference distributions for the percentile + time-on-market
    // panels. avg_price on market_sellers is the materialised median
    // listing price per seller; we only need positive, in-range
    // values to anchor the percentile bar.
    supabase
      .from("market_sellers")
      .select("avg_price")
      .gt("avg_price", 0)
      .lt("avg_price", 10000)
      .limit(5000),
    supabase
      .from("sold_listings_v")
      .select("days_to_sell")
      .gte("days_to_sell", 0)
      .limit(5000),
  ]);

  if (sellerRes.error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
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

  // For the percentile widget: compute this seller's median listing
  // price from live + recent listings rather than trusting the
  // materialised avg_price column, which lags. Falls back to
  // seller.avg_price when there are too few priced listings on this
  // page's slice.
  const sellerListingPrices = listings
    .map((l) => l.price_usd_equivalent ?? l.price)
    .filter((p): p is number => typeof p === "number" && p > 0 && p < 10_000);
  const sellerMedian =
    sellerListingPrices.length >= 3
      ? median(sellerListingPrices) ?? 0
      : seller.avg_price ?? 0;
  const marketSellerMedians = (marketSellerMediansRes.data ?? [])
    .map((r) => Number(r.avg_price))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 10_000);

  const sellerDaysToSell = sold
    .map((s) => s.days_to_sell)
    .filter((d): d is number => typeof d === "number" && d >= 0);
  const marketDaysToSell = (marketDaysToSellRes.data ?? [])
    .map((r) => Number(r.days_to_sell))
    .filter((n) => Number.isFinite(n) && n >= 0);

  // Derive a small set of annotations from the seller's own data so
  // the snapshot trend chart is self-narrating. First scrape marks
  // where the curve actually begins (helps differentiate a real
  // plateau from "we just started watching"); biggest recent jump in
  // feedback flags a likely sale cluster worth reading the timeline
  // around.
  const sortedSnapshots = [...snapshots]
    .filter((s) => s.observed_at)
    .sort(
      (a, b) =>
        Date.parse(a.observed_at!) - Date.parse(b.observed_at!),
    );
  const snapshotEvents: ChartEvent[] = [];
  if (sortedSnapshots.length > 0) {
    snapshotEvents.push({
      at: new Date(sortedSnapshots[0]!.observed_at!),
      label: "First scrape",
      tone: "info",
    });
  }
  if (sortedSnapshots.length >= 3) {
    // Largest single-step feedback jump in the window — proxy for a
    // batch sale that pulled the seller's review count up.
    let bestIdx = -1;
    let bestDelta = 0;
    for (let i = 1; i < sortedSnapshots.length; i++) {
      const a = sortedSnapshots[i - 1]!.feedback_count;
      const b = sortedSnapshots[i]!.feedback_count;
      if (typeof a !== "number" || typeof b !== "number") continue;
      const delta = b - a;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx > 0 && bestDelta >= 3) {
      snapshotEvents.push({
        at: new Date(sortedSnapshots[bestIdx]!.observed_at!),
        label: `+${bestDelta} feedback jump`,
        tone: "positive",
      });
    }
  }

  // Pull recent photos from market_listings → listings join. The scraper
  // writes primary_image_url onto the listings table (keyed on the raw
  // numeric listing_id). market_listings.id is the mm_-prefixed form so
  // we strip the prefix to match.
  const photoIds = listings.slice(0, 12).map((l) =>
    l.id.startsWith("mm_") ? l.id.slice(3) : l.id,
  );
  let photos: Array<{ listing_id: string; primary_image_url: string | null; name: string | null }> = [];
  if (photoIds.length > 0) {
    const photoRes = await supabase
      .from("listings")
      .select("listing_id, primary_image_url, name")
      .in("listing_id", photoIds)
      .not("primary_image_url", "is", null)
      .limit(12);
    photos = (photoRes.data ?? []) as typeof photos;
  }

  const listingColumns: Column<ListingRow>[] = [
    {
      key: "title",
      header: "Listing",
      render: (r) => (
        <div>
          <div className="font-medium text-ink-100">{r.title ?? r.id}</div>
          <div className="text-xs text-ink-400">{r.id}</div>
        </div>
      ),
    },
    { key: "maturity", header: "Maturity", render: (r) => r.maturity ?? "—" },
    { key: "sex", header: "Sex", render: (r) => r.sex ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span className="inline-flex items-center rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-200">
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
    <div className="page-rise space-y-8">
      <div>
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-500"
        >
          <Link
            href="/sellers"
            className="transition hover:text-claude-glow"
          >
            Sellers
          </Link>
          <span aria-hidden>/</span>
          <span className="text-ink-300">{seller.seller_name ?? seller.seller_id}</span>
        </nav>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-display text-[34px] font-medium leading-tight tracking-tight text-ink-50">
            {seller.seller_name ?? seller.seller_id}
          </h1>
          <div className="flex items-center gap-2">
            {seller.five_star_rating != null ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-clay-400/40 bg-clay-500/10 px-2 py-0.5 text-xs text-clay-300">
                ★ {seller.five_star_rating.toFixed(1)}
              </span>
            ) : null}
            <WatchButton
              label="Watch seller"
              alertName={`Seller: ${seller.seller_name ?? seller.seller_id}`}
              query={{ kind: "seller", seller_id: seller.seller_id }}
              size="md"
            />
          </div>
        </div>
        <p className="mt-1 text-sm text-ink-400">
          {[seller.seller_location, seller.membership].filter(Boolean).join(" · ") ||
            "—"}
        </p>
        {seller.morph_specialization ? (
          <p className="mt-1 text-xs text-ink-500">
            <span className="text-ink-400">Specializes in</span>{" "}
            <span className="text-ink-200">{seller.morph_specialization}</span>
          </p>
        ) : null}
      </div>

      {photos.length > 0 ? (
        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
            Recent stock
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {photos.map((p) => (
              <a
                key={p.listing_id}
                href={`https://www.morphmarket.com/us/c/reptiles/lizards/crested-geckos/${p.listing_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative aspect-square overflow-hidden rounded-md border border-ink-700/60"
                title={p.name ?? p.listing_id}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.primary_image_url ?? ""}
                  alt={p.name ?? p.listing_id}
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Live listings" value={liveCount} tone="positive" />
        <KpiCard label="Sold tracked" value={soldCount} />
        <KpiCard
          label="Median days-to-sell"
          value={medianDays != null ? `${Math.round(medianDays)} d` : "—"}
        />
        <KpiCard label="Feedback" value={fmtInt(seller.feedback_count)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SellerPercentile
          sellerMedian={sellerMedian}
          marketMedians={marketSellerMedians}
        />
        <TimeOnMarketHistogram
          sellerDays={sellerDaysToSell}
          marketDays={marketDaysToSell}
        />
      </div>

      <Panel
        title="Snapshot trend"
        subtitle="Feedback and listings over time. Dotted markers flag the first scrape and notable feedback jumps so the curve has context."
      >
        {snapshots.length >= 2 ? (
          <TimeSeriesLine
            series={[feedbackSeries, listingsSeries]}
            events={snapshotEvents}
            yLabel="count"
          />
        ) : (
          <p className="py-6 text-center text-sm text-ink-400">
            Not enough snapshots yet. The extension will build this up as you
            revisit this seller.
          </p>
        )}
      </Panel>

      <section>
        <h2 className="mb-3 font-display text-[20px] font-medium tracking-tight text-ink-50">Current & recent listings</h2>
        <DataTable
          columns={listingColumns}
          rows={listings}
          rowKey={(r) => r.id}
          emptyMessage="No listings linked to this seller yet."
        />
      </section>

      <section>
        <h2 className="mb-3 font-display text-[20px] font-medium tracking-tight text-ink-50">Recently sold</h2>
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
