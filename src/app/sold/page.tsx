// Sold listings — the comps tool. Pulls from sold_listings_v and lets
// the URL slice the view by morph (title contains), maturity, and sex.
// Every downstream panel (histogram, by-maturity, table, ChartGrid)
// renders the same filtered slice so the page tells one coherent
// story about whichever subset you're looking at.
import ChartGrid from "@/components/charts/ChartGrid";
import KpiCard from "@/components/ui/KpiCard";
import { SectionHeader } from "@/components/ui/Panel";
import DataFreshness from "@/components/ui/DataFreshness";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtUsd } from "@/lib/format";
import SoldPriceDistribution from "@/components/sold/SoldPriceDistribution";
import SoldByMaturity from "@/components/sold/SoldByMaturity";
import SoldFilters from "@/components/sold/SoldFilters";
import SortableSoldTable, {
  type SoldRow,
} from "@/components/sold/SortableSoldTable";

export const dynamic = "force-dynamic";

type SearchParams = {
  morph?: string;
  maturity?: string;
  sex?: string;
};

function normaliseMaturity(m: string | null | undefined): string {
  if (!m) return "Unknown";
  const lower = m.toLowerCase();
  if (lower.startsWith("juv")) return "Juvenile";
  if (lower.startsWith("sub")) return "Subadult";
  if (lower.startsWith("adult")) return "Adult";
  return "Unknown";
}

function applyFilters(rows: SoldRow[], f: SearchParams): SoldRow[] {
  const morph = f.morph?.toLowerCase().trim();
  const maturity = f.maturity?.trim();
  const sex = f.sex?.toLowerCase().trim();
  return rows.filter((r) => {
    if (morph) {
      const hay = (r.title ?? "").toLowerCase();
      if (!hay.includes(morph)) return false;
    }
    if (maturity) {
      if (normaliseMaturity(r.maturity) !== maturity) return false;
    }
    if (sex) {
      if ((r.sex ?? "").toLowerCase() !== sex) return false;
    }
    return true;
  });
}

export default async function SoldPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
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

  const allRows = (data ?? []) as SoldRow[];
  const soldEvents = (soldEventsRes.data ?? []) as { observed_at: string }[];
  const rows = applyFilters(allRows, searchParams ?? {});
  const filtered = allRows.length !== rows.length;

  const days = rows
    .map((r) => r.days_to_sell)
    .filter((d): d is number => typeof d === "number" && d >= 0);
  const medianPrice = median(rows.map((r) => r.price_usd_equivalent ?? r.price));
  const sevenDayCount = rows.filter(
    (r) => r.sold_at && Date.now() - Date.parse(r.sold_at) < 7 * 86400_000,
  ).length;
  const inferredCount = rows.filter((r) => r.sold_source === "extension_inferred").length;

  const filterSummary = [
    searchParams?.morph,
    searchParams?.maturity,
    searchParams?.sex,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Outcomes / Comps"
        title="Sold"
        description={
          filtered
            ? `Showing ${fmtInt(rows.length)} of ${fmtInt(allRows.length)} recent sold listings narrowed by ${filterSummary}. The histogram, cohort multiples, and table all reflect this slice.`
            : "Listings that have flipped from live to sold — either explicitly captured by the extension or inferred from absence. Narrow the slice with the filter below."
        }
        right={<DataFreshness updatedAt={Date.now()} window="all time" />}
      />

      <SoldFilters />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={filtered ? "Sold (matching filter)" : "Sold (all time)"}
          value={fmtInt(rows.length)}
        />
        <KpiCard label="Sold past 7 days" value={fmtInt(sevenDayCount)} tone="positive" />
        <KpiCard
          label="Median time-to-sell"
          value={days.length ? `${Math.round(median(days) ?? 0)} d` : "—"}
        />
        <KpiCard label="Median sold price" value={fmtUsd(medianPrice)} />
      </div>

      {rows.length >= 5 ? (
        <SoldPriceDistribution
          prices={rows.map((r) => r.price_usd_equivalent ?? r.price)}
        />
      ) : filtered ? (
        <section className="surface p-5">
          <p className="text-sm text-ink-400">
            Only {fmtInt(rows.length)} sold listings match this slice — too few
            to draw a distribution. Try widening the filter.
          </p>
        </section>
      ) : null}

      <SoldByMaturity
        rows={rows.map((r) => ({ maturity: r.maturity, sold_at: r.sold_at }))}
      />

      <ChartGrid page="sold" ctx={{ soldRows: rows, soldEvents }} />

      {inferredCount > 0 ? (
        <p className="text-xs text-ink-400">
          {fmtInt(inferredCount)} sold events inferred from absence (14d rule).
        </p>
      ) : null}

      <section>
        <h2 className="mb-3 font-display text-[20px] font-medium tracking-tight text-ink-50">
          Recently sold
        </h2>
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
