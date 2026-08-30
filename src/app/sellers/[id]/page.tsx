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
import SellerAvatar from "@/components/media/SellerAvatar";
import ListingImage from "@/components/media/ListingImage";
import {
  getListingImageMap,
  getSellerVisualMap,
} from "@/lib/media/market-images";

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
  // 'captured_event' means the pipeline watched the listing flip to sold.
  // 'inferred_unseen' means the catalogue walk stopped seeing it. A seller
  // pulling a listing looks identical to a sale from the outside, so the
  // distinction is shown rather than averaged away.
  sold_basis: string | null;
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
    // v_sold_reconciled (migration 0045), not sold_listings_v. The old view
    // joined only listing_status_events: 92 rows from four days in May across
    // the whole marketplace, so most sellers showed an empty sold table while
    // their inferred sales went unreported. Lots are excluded because their
    // price covers several animals and would distort the sold price column.
    supabase
      .from("v_sold_reconciled")
      .select("id, title, price_usd_equivalent, price, sold_at, days_to_sell, sold_basis")
      .eq("seller_id", sellerId)
      .eq("is_group_lot", false)
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
    // Market-wide time-on-market reference for the percentile bar. Same view
    // swap, and the same reason: 92 rows is not a distribution.
    supabase
      .from("v_sold_reconciled")
      .select("days_to_sell")
      .eq("is_group_lot", false)
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

  // Resolve visual context separately from identity. The circular image is
  // the marketplace store avatar; every rectangular image is labelled and
  // linked as inventory from an exact listing id.
  const imageTargetIds = [
    ...listings.slice(0, 48).map((row) => row.id),
    ...sold.slice(0, 24).map((row) => row.id),
  ];
  const [sellerVisuals, listingImages] = await Promise.all([
    getSellerVisualMap(supabase, [sellerId]),
    getListingImageMap(supabase, imageTargetIds),
  ]);
  const sellerVisual = sellerVisuals.get(sellerId);
  const photos = listings
    .filter((row) => listingImages.has(row.id))
    .slice(0, 12)
    .map((row) => ({
      listing_id: row.id,
      image_url: listingImages.get(row.id)!,
      name: row.title,
    }));

  const listingColumns: Column<ListingRow>[] = [
    {
      key: "title",
      header: "Listing",
      render: (r) => (
        <Link
          href={`/listings/${r.id}`}
          className="group inline-flex items-center gap-3"
        >
          {listingImages.get(r.id) ? (
            <ListingImage
              src={listingImages.get(r.id)}
              alt={r.title ?? r.id}
              className="h-11 w-11 shrink-0 rounded-sm"
              sizes="44px"
              showFallback={false}
            />
          ) : null}
          <span>
            <span className="block font-medium text-ink-100 transition group-hover:text-claude-glow">
              {r.title ?? r.id}
            </span>
            <span className="block text-xs text-ink-400">{r.id}</span>
          </span>
        </Link>
      ),
    },
    { key: "maturity", header: "Maturity", render: (r) => r.maturity ?? "no data" },
    { key: "sex", header: "Sex", render: (r) => r.sex ?? "no data" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span className="inline-flex items-center rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-200">
          {r.current_status ?? "no data"}
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
      render: (r) => (
        <Link
          href={`/listings/${r.id}`}
          className="group inline-flex items-center gap-3"
        >
          {listingImages.get(r.id) ? (
            <ListingImage
              src={listingImages.get(r.id)}
              alt={r.title ?? r.id}
              className="h-10 w-10 shrink-0 rounded-sm"
              sizes="40px"
              showFallback={false}
            />
          ) : null}
          <span className="transition group-hover:text-claude-glow">
            {r.title ?? r.id}
          </span>
        </Link>
      ),
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
    {
      key: "basis",
      header: "Evidence",
      render: (r) =>
        r.sold_basis === "captured_event" ? (
          <span className="text-ink-300">observed sold</span>
        ) : (
          <span
            className="text-ink-400"
            title="The catalogue walk stopped seeing the listing, so a sale is inferred from its absence. The seller may simply have pulled it."
          >
            inferred
          </span>
        ),
    },
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <SellerAvatar
              name={seller.seller_name ?? seller.seller_id}
              imageUrl={sellerVisual?.avatarUrl}
              size={72}
              priority
            />
            <div className="min-w-0">
              <h1 className="font-display text-[34px] font-medium leading-tight tracking-tight text-ink-50">
                {seller.seller_name ?? seller.seller_id}
              </h1>
              <p className="mt-1 text-sm text-ink-400">
                {[seller.seller_location, seller.membership]
                  .filter(Boolean)
                  .join(" · ") || "no data"}
              </p>
            </div>
          </div>
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
              <Link
                key={p.listing_id}
                href={`/listings/${p.listing_id}`}
                className="group"
                title={p.name ?? p.listing_id}
              >
                <ListingImage
                  src={p.image_url}
                  alt={p.name ?? p.listing_id}
                  className="aspect-square w-full rounded-sm"
                  sizes="(min-width: 768px) 14vw, (min-width: 640px) 22vw, 46vw"
                  label="Listing"
                />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Live listings" value={liveCount} tone="positive" />
        <KpiCard label="Sold tracked" value={soldCount} />
        <KpiCard
          label="Median days-to-sell"
          value={medianDays != null ? `${Math.round(medianDays)} d` : "no data"}
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
