// Sold listings — the primary outcome view. Pulls from the sold_listings_v
// view (market_listings JOIN listing_status_events where status='sold').
// Page-owned hero histogram + ChartGrid + sortable table.
import ChartGrid from "@/components/charts/ChartGrid";
import KpiCard from "@/components/ui/KpiCard";
import { SectionHeader } from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtUsd } from "@/lib/format";
import SoldPriceDistribution from "@/components/sold/SoldPriceDistribution";
import SortableSoldTable, {
  type SoldRow,
} from "@/components/sold/SortableSoldTable";

export const dynamic = "force-dynamic";

export default async function SoldPage() {
  const supabase = createClient();
  const [{ data, error }, soldEventsRes] = await Promise.all([
    supabase
      .from("sold_listings_v")
      .select(
        "id, seller_id, title, price, price_usd_equivalent, maturity, sex, first_seen_at, sold_at, days_to_sell, sold_source",
      )
      .order("sold_at", { ascending: false })
      .limit(500),
    supabase
      .from("listing_status_events")
      .select("id, observed_at")
      .eq("status", "sold")
      .order("observed_at", { ascending: true })
      .limit(20000),
  ]);

  if (error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
        Failed to load sold listings: {error.message}
      </div>
    );
  }

  const rows = (data ?? []) as SoldRow[];
  const soldEvents = (soldEventsRes.data ?? []) as { observed_at: string }[];

  const days = rows
    .map((r) => r.days_to_sell)
    .filter((d): d is number => typeof d === "number" && d >= 0);
  const medianPrice = median(rows.map((r) => r.price_usd_equivalent ?? r.price));
  const sevenDayCount = rows.filter(
    (r) => r.sold_at && Date.now() - Date.parse(r.sold_at) < 7 * 86400_000,
  ).length;
  const inferredCount = rows.filter((r) => r.sold_source === "extension_inferred").length;

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Outcomes"
        title="Sold"
        description="Listings that have flipped from live to sold — either explicitly captured by the extension or inferred from absence."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Sold (all time)" value={fmtInt(rows.length)} />
        <KpiCard label="Sold past 7 days" value={fmtInt(sevenDayCount)} tone="positive" />
        <KpiCard
          label="Median time-to-sell"
          value={days.length ? `${Math.round(median(days) ?? 0)} d` : "—"}
        />
        <KpiCard label="Median sold price" value={fmtUsd(medianPrice)} />
      </div>

      <SoldPriceDistribution
        prices={rows.map((r) => r.price_usd_equivalent ?? r.price)}
      />

      <ChartGrid page="sold" ctx={{ soldRows: rows, soldEvents }} />

      {inferredCount > 0 ? (
        <p className="text-xs text-ink-400">
          {fmtInt(inferredCount)} sold events inferred from absence (14d rule).
        </p>
      ) : null}

      <section>
        <h2 className="mb-3 font-display text-[20px] font-medium tracking-tight text-ink-50">Recently sold</h2>
        <SortableSoldTable rows={rows} />
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
