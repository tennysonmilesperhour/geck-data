// Recent price drops, sorted by observed_at. Joins against market_listings to
// show the title and current price context.
import DataTable, { type Column } from "@/components/ui/DataTable";
import KpiCard from "@/components/ui/KpiCard";
import { SectionHeader } from "@/components/ui/Panel";
import DataFreshness from "@/components/ui/DataFreshness";
import DropAnalytics from "@/components/price-drops/DropAnalytics";
import { createClient } from "@/lib/supabase/server";
import { fmtPct, fmtRelative, fmtUsd } from "@/lib/format";
import WatchButton from "@/components/alerts/WatchButton";

const STRIP_TOKENS = /\b(male|female|unsexed|juv(?:enile)?|sub(?:adult)?|adult|babies?|hatchling|breeder|pair|trio)\b/gi;
function morphTermFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const cleaned = title
    .replace(STRIP_TOKENS, " ")
    .replace(/\$[\d,]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned.length >= 3 ? cleaned : null;
}

export const dynamic = "force-dynamic";

type DropRow = {
  id: string;
  listing_id: string;
  old_price: number | null;
  new_price: number | null;
  old_price_usd: number | null;
  new_price_usd: number | null;
  currency: string | null;
  pct_change: number | null;
  observed_at: string | null;
  market_listings: {
    title: string | null;
    seller_id: string | null;
    maturity: string | null;
    sex: string | null;
  } | null;
};

export default async function PriceDropsPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("price_drops")
    .select(
      "id, listing_id, old_price, new_price, old_price_usd, new_price_usd, currency, pct_change, observed_at, market_listings!inner(title, seller_id, maturity, sex)",
    )
    .order("observed_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
        Failed to load price drops: {error.message}
      </div>
    );
  }

  const rows = (data ?? []) as unknown as DropRow[];

  const sevenDay = rows.filter(
    (r) => r.observed_at && Date.now() - Date.parse(r.observed_at) < 7 * 86400_000,
  );
  const avgPct =
    rows.length > 0
      ? rows.reduce((a, r) => a + (r.pct_change ?? 0), 0) / rows.length
      : null;
  const biggest = rows.reduce<DropRow | null>(
    (best, r) =>
      r.pct_change != null && (best == null || r.pct_change < (best.pct_change ?? 0))
        ? r
        : best,
    null,
  );

  const columns: Column<DropRow>[] = [
    {
      key: "listing",
      header: "Listing",
      render: (r) => (
        <div>
          <div className="font-medium text-ink-100">
            {r.market_listings?.title ?? r.listing_id}
          </div>
          <div className="text-xs text-ink-400">{r.listing_id}</div>
        </div>
      ),
    },
    {
      key: "change",
      header: "Change",
      align: "right",
      render: (r) => (
        <span
          className={`font-semibold ${
            (r.pct_change ?? 0) < 0 ? "text-danger" : "text-ready"
          }`}
        >
          {fmtPct(r.pct_change)}
        </span>
      ),
    },
    {
      key: "old",
      header: "Was",
      align: "right",
      render: (r) => (
        <span className="text-ink-400 line-through">
          {fmtUsd(r.old_price_usd ?? r.old_price)}
        </span>
      ),
    },
    {
      key: "new",
      header: "Now",
      align: "right",
      render: (r) => fmtUsd(r.new_price_usd ?? r.new_price),
    },
    // Seller column removed: market_listings rows created via priceDrop
    // events arrive as stubs (id only) without seller info, and the
    // ingest stream rarely backfills seller_id for these specific rows.
    // The result was a column of "—" placeholders that read as a layout
    // bug. Restore once handlePriceDrop hydrates seller info — see
    // src/lib/ingest/events.ts handlePriceDrop, around the
    // ensureListingStub call: it could pull the parent listing's seller
    // fields from a search-result batch when present.
    { key: "when", header: "When", render: (r) => fmtRelative(r.observed_at) },
    {
      key: "watch",
      header: "Watch",
      align: "right",
      render: (r) => {
        const term = morphTermFromTitle(r.market_listings?.title);
        if (!term) return null;
        return (
          <WatchButton
            label="Watch"
            alertName={`Morph: ${term.slice(0, 60)}`}
            query={{ kind: "morph", term }}
          />
        );
      },
    },
  ];

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Signals"
        title="Price drops"
        description="Explicit price reductions the extension captured on revisit."
        right={<DataFreshness updatedAt={Date.now()} window="30 days" />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Drops (all time)" value={rows.length} />
        <KpiCard label="Drops past 7 days" value={sevenDay.length} tone="warn" />
        <KpiCard label="Average discount" value={fmtPct(avgPct)} />
        <KpiCard
          label="Biggest drop"
          value={biggest ? fmtPct(biggest.pct_change) : "—"}
          sub={biggest?.market_listings?.title ?? biggest?.listing_id ?? undefined}
          tone="negative"
        />
      </div>

      <DropAnalytics
        rows={rows.map((r) => ({
          observed_at: r.observed_at,
          pct_change: r.pct_change,
        }))}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No price drops captured yet."
      />
    </div>
  );
}
