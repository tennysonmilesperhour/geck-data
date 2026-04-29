// Sold listings — the primary outcome view. Pulls from the sold_listings_v
// view (market_listings JOIN listing_status_events where status='sold').
// Charts above the table come from <ChartGrid>; the table itself stays
// page-owned as the navigational entry point.
import Link from "next/link";
import ChartGrid from "@/components/charts/ChartGrid";
import DataTable, { type Column } from "@/components/ui/DataTable";
import KpiCard from "@/components/ui/KpiCard";
import { SectionHeader } from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtInt, fmtRelative, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

type SoldRow = {
  id: string;
  seller_id: string | null;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  maturity: string | null;
  sex: string | null;
  first_seen_at: string | null;
  sold_at: string | null;
  days_to_sell: number | null;
  sold_source: string | null;
};

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

  const columns: Column<SoldRow>[] = [
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
      key: "price",
      header: "Price",
      align: "right",
      render: (r) => fmtUsd(r.price_usd_equivalent ?? r.price),
    },
    {
      key: "days",
      header: "Days",
      align: "right",
      render: (r) => fmtInt(r.days_to_sell),
    },
    {
      key: "sold_at",
      header: "Sold",
      render: (r) => (
        <span title={fmtDate(r.sold_at)}>{fmtRelative(r.sold_at)}</span>
      ),
    },
    {
      key: "seller",
      header: "Seller",
      render: (r) =>
        r.seller_id ? (
          <Link href={`/sellers/${r.seller_id}`} className="text-claude hover:underline">
            {r.seller_id}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      key: "source",
      header: "Source",
      render: (r) => (
        <span className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-200">
          {r.sold_source ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
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

      <ChartGrid page="sold" ctx={{ soldRows: rows, soldEvents }} />

      {inferredCount > 0 ? (
        <p className="text-xs text-ink-400">
          {fmtInt(inferredCount)} sold events inferred from absence (14d rule).
        </p>
      ) : null}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink-50">Recently sold</h2>
        <DataTable
          columns={columns}
          rows={rows.slice(0, 200)}
          rowKey={(r) => r.id}
          emptyMessage="No sold listings recorded yet."
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
