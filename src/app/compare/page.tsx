// Comparative Analysis — side-by-side sections for three kinds of
// comparison a gecko breeder or trader cares about:
//   1) Trait-vs-market pricing premium (which traits command a premium)
//   2) Maturity cohorts (juvenile / subadult / adult price bands)
//   3) Sellers head-to-head (inventory, price band, reach)
// Each section is self-contained and reads from the current snapshot.
import Link from "next/link";
import { Panel, SectionHeader, StatusPill } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { chartTheme } from "@/components/charts/theme";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtPct, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

type Listing = {
  id: string;
  seller_id: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  maturity: string | null;
  sex: string | null;
  norm_traits: string | null;
  cached_traits: string | null;
};

type Seller = {
  seller_id: string;
  seller_name: string | null;
  seller_location: string | null;
  membership: string | null;
  feedback_count: number | null;
  total_listings: number | null;
  avg_price: number | null;
  five_star_rating: number | null;
};

function priceOf(l: Listing): number | null {
  const p = l.price_usd_equivalent ?? l.price;
  return p && p > 0 && p < 10_000 ? p : null;
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function traitSet(l: Listing): Set<string> {
  const raw = (l.norm_traits || l.cached_traits || "").toLowerCase();
  if (!raw) return new Set();
  const tokens = raw.includes(",")
    ? raw.split(",").map((t) => t.trim())
    : raw.split(/\s+/).map((t) => t.trim());
  return new Set(tokens.filter((t) => t && t.length >= 3));
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams?: { sellers?: string };
}) {
  // ?sellers=id1,id2,id3 narrows the head-to-head section to those
  // sellers. Empty / missing param falls back to "top 15 by inventory
  // value" so existing links and direct visits still get a useful page.
  const focusedSellerIds = (searchParams?.sellers ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const focusMode = focusedSellerIds.length > 0;

  const supabase = createClient();

  const [listingsRes, sellersRes] = await Promise.all([
    supabase
      .from("market_listings")
      .select(
        "id, seller_id, price, price_usd_equivalent, maturity, sex, norm_traits, cached_traits",
      )
      .limit(20000),
    supabase
      .from("market_sellers")
      .select(
        "seller_id, seller_name, seller_location, membership, feedback_count, total_listings, avg_price, five_star_rating",
      )
      .limit(5000),
  ]);

  const listings = (listingsRes.data ?? []) as Listing[];
  const sellers = (sellersRes.data ?? []) as Seller[];

  // Market baselines
  const allPrices = listings.map(priceOf).filter((p): p is number => p !== null);
  const marketMedian = median(allPrices) ?? 0;

  // --- 1) Trait premium vs market median --------------------------------
  const traitStats = new Map<string, number[]>(); // trait -> prices
  for (const l of listings) {
    const p = priceOf(l);
    if (p == null) continue;
    for (const t of traitSet(l)) {
      const arr = traitStats.get(t) ?? [];
      arr.push(p);
      traitStats.set(t, arr);
    }
  }
  type TraitRow = { trait: string; count: number; median: number; premium: number };
  const traitRows: TraitRow[] = [];
  for (const [trait, prices] of traitStats) {
    if (prices.length < 5) continue;
    const m = median(prices)!;
    traitRows.push({
      trait,
      count: prices.length,
      median: m,
      premium: marketMedian > 0 ? ((m - marketMedian) / marketMedian) * 100 : 0,
    });
  }
  const topPremium = [...traitRows].sort((a, b) => b.premium - a.premium).slice(0, 12);
  const bottomPremium = [...traitRows].sort((a, b) => a.premium - b.premium).slice(0, 12);

  const premiumBarMax = Math.max(1, ...topPremium.map((t) => Math.abs(t.premium)));
  const discountBarMax = Math.max(1, ...bottomPremium.map((t) => Math.abs(t.premium)));

  // --- 2) Maturity band bands ------------------------------------------
  type Band = { label: string; count: number; median: number; p25: number; p75: number };
  const bands: Band[] = [];
  const orderedMaturities = ["Juvenile", "Subadult", "Adult", "unknown"];
  for (const mat of orderedMaturities) {
    const prices = listings
      .filter((l) => (l.maturity ?? "unknown") === mat)
      .map(priceOf)
      .filter((p): p is number => p !== null)
      .sort((a, b) => a - b);
    if (prices.length === 0) continue;
    bands.push({
      label: mat,
      count: prices.length,
      median: prices[Math.floor(prices.length / 2)],
      p25: prices[Math.floor(prices.length * 0.25)],
      p75: prices[Math.floor(prices.length * 0.75)],
    });
  }
  const bandMax = Math.max(1, ...bands.map((b) => b.p75));

  // --- 3) Seller head-to-head ------------------------------------------
  // Pick top sellers by listings; compute inventory value and price band from listings.
  const priceBySeller = new Map<string, number[]>();
  for (const l of listings) {
    const p = priceOf(l);
    if (p == null || !l.seller_id) continue;
    const arr = priceBySeller.get(l.seller_id) ?? [];
    arr.push(p);
    priceBySeller.set(l.seller_id, arr);
  }

  const sellersAll = sellers
    .map((s) => {
      const prices = priceBySeller.get(s.seller_id) ?? [];
      prices.sort((a, b) => a - b);
      const medP = prices.length
        ? prices[Math.floor(prices.length / 2)] ?? 0
        : s.avg_price ?? 0;
      const inventoryValue = prices.reduce((a, b) => a + b, 0);
      return { seller: s, count: prices.length, median: medP, inventoryValue };
    })
    .filter((r) => r.count > 0);

  const sellersEnriched = focusMode
    ? // Respect URL order: a shared link should put the requested
      // sellers in the exact order the URL specifies (it might encode
      // the share author's intended ordering).
      focusedSellerIds
        .map((id) => sellersAll.find((r) => r.seller.seller_id === id))
        .filter((r): r is (typeof sellersAll)[number] => Boolean(r))
    : sellersAll.sort((a, b) => b.inventoryValue - a.inventoryValue).slice(0, 15);

  const maxInventoryValue = Math.max(1, ...sellersEnriched.map((r) => r.inventoryValue));
  const maxListings = Math.max(1, ...sellersEnriched.map((r) => r.count));

  const sellerCols: Column<typeof sellersEnriched[number]>[] = [
    {
      key: "seller",
      header: "Seller",
      render: (row) => (
        <Link
          href={`/sellers/${row.seller.seller_id}`}
          className="text-ink-100 hover:text-claude-glow"
        >
          {row.seller.seller_name ?? row.seller.seller_id}
        </Link>
      ),
    },
    {
      key: "loc",
      header: "Location",
      render: (row) => (
        <span className="text-ink-400">{row.seller.seller_location ?? "—"}</span>
      ),
    },
    {
      key: "membership",
      header: "Tier",
      render: (row) => (
        <span className="font-mono text-[11px] text-ink-300">
          {row.seller.membership ?? "—"}
        </span>
      ),
    },
    {
      key: "listings",
      header: "Listings",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1 w-14 rounded bg-ink-700">
            <div
              className="h-1 rounded bg-claude"
              style={{ width: `${Math.round((row.count / maxListings) * 100)}%` }}
            />
          </div>
          <span className="tabular-nums">{fmtInt(row.count)}</span>
        </div>
      ),
    },
    {
      key: "median",
      header: "Median",
      align: "right",
      render: (row) => <span className="tabular-nums">{fmtUsd(row.median)}</span>,
    },
    {
      key: "inventoryValue",
      header: "Inventory value",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1 w-16 rounded bg-ink-700">
            <div
              className="h-1 rounded bg-info"
              style={{
                width: `${Math.round((row.inventoryValue / maxInventoryValue) * 100)}%`,
              }}
            />
          </div>
          <span className="tabular-nums">{fmtUsd(row.inventoryValue)}</span>
        </div>
      ),
    },
    {
      key: "feedback",
      header: "Feedback",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-ink-400">
          {fmtInt(row.seller.feedback_count ?? 0)}
        </span>
      ),
    },
  ];

  return (
    <div className="page-rise space-y-10">
      <SectionHeader
        eyebrow="Analysis / Compare"
        title="Comparative Analysis"
        description="Head-to-head comparisons across three dimensions: traits (which ones carry a premium), maturity cohorts (price bands), and sellers (inventory, reach, and median pricing)."
        right={<StatusPill status="info" label="live snapshot" />}
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Market median" value={fmtUsd(marketMedian)} tone="info" />
        <KpiCard label="Traits ≥ 5 listings" value={fmtInt(traitRows.length)} />
        <KpiCard label="Active sellers" value={fmtInt(sellersEnriched.length)} sub="w/ priced listings" />
        <KpiCard label="Maturity cohorts" value={fmtInt(bands.length)} />
      </section>

      <Panel
        title="Trait premium vs. market median"
        subtitle="Positive means listings with this trait price above the market median. Negative means below. Minimum 5 priced listings."
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ready">
              Premium traits
            </div>
            <ul className="space-y-1.5">
              {topPremium.map((t) => {
                const w = Math.round((Math.abs(t.premium) / premiumBarMax) * 100);
                return (
                  <li
                    key={t.trait}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm"
                  >
                    <span className="truncate text-ink-100">{t.trait}</span>
                    <div className="h-1.5 w-40 rounded bg-ink-700">
                      <div
                        className="h-1.5 rounded"
                        style={{ width: `${w}%`, background: chartTheme.positive }}
                      />
                    </div>
                    <span className="w-28 text-right font-mono text-[12px]">
                      <span className="text-ready">{fmtPct(t.premium, 0)}</span>
                      <span className="ml-2 text-ink-500">· {fmtUsd(t.median)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-danger">
              Discount traits
            </div>
            <ul className="space-y-1.5">
              {bottomPremium.map((t) => {
                const w = Math.round((Math.abs(t.premium) / discountBarMax) * 100);
                return (
                  <li
                    key={t.trait}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm"
                  >
                    <span className="truncate text-ink-100">{t.trait}</span>
                    <div className="h-1.5 w-40 rounded bg-ink-700">
                      <div
                        className="h-1.5 rounded"
                        style={{ width: `${w}%`, background: chartTheme.negative }}
                      />
                    </div>
                    <span className="w-28 text-right font-mono text-[12px]">
                      <span className="text-danger">{fmtPct(t.premium, 0)}</span>
                      <span className="ml-2 text-ink-500">· {fmtUsd(t.median)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel
        title="Maturity price bands"
        subtitle="25th → 75th percentile for each maturity, with the median marked. Narrow bands mean a tight market; wide bands mean price dispersion."
      >
        <div className="space-y-3">
          {bands.map((b, i) => {
            const leftPct = Math.round((b.p25 / bandMax) * 100);
            const widthPct = Math.max(2, Math.round(((b.p75 - b.p25) / bandMax) * 100));
            const medPct = Math.round((b.median / bandMax) * 100);
            return (
              <div key={b.label} className="grid grid-cols-[120px_1fr_160px] items-center gap-4">
                <div>
                  <div
                    className="font-mono text-[10px] uppercase tracking-wider"
                    style={{ color: chartTheme.series[i % chartTheme.series.length] }}
                  >
                    {b.label}
                  </div>
                  <div className="text-xs text-ink-400">{fmtInt(b.count)} listings</div>
                </div>
                <div className="relative h-4 rounded bg-ink-700/60">
                  <div
                    className="absolute h-4 rounded"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      background: chartTheme.series[i % chartTheme.series.length],
                      opacity: 0.55,
                    }}
                  />
                  <div
                    className="absolute top-0 h-4 w-0.5"
                    style={{
                      left: `${medPct}%`,
                      background: "#f5f5f5",
                    }}
                  />
                </div>
                <div className="text-right font-mono text-[12px] text-ink-300">
                  {fmtUsd(b.p25)} <span className="text-ink-500">→</span>{" "}
                  <span className="text-ink-100">{fmtUsd(b.median)}</span>{" "}
                  <span className="text-ink-500">→</span> {fmtUsd(b.p75)}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Seller head-to-head"
        subtitle={
          focusMode
            ? `Comparing the ${sellersEnriched.length} seller${sellersEnriched.length === 1 ? "" : "s"} from the share link. Drop the ?sellers= param to see the top 15 by inventory.`
            : "Top 15 sellers by current inventory value (sum of priced listings). Bars show rank within this view."
        }
        padded={false}
      >
        <DataTable
          columns={sellerCols}
          rows={sellersEnriched}
          rowKey={(r) => r.seller.seller_id}
          emptyMessage="No sellers with priced listings."
        />
      </Panel>

      <Panel tone="soft" title="How to read this page">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-300">
          <li>
            <span className="text-ink-100">Trait premium</span> divides the median
            price of listings carrying the trait by the market median — not a
            perfect control (traits co-occur), but a fast directional signal.
          </li>
          <li>
            <span className="text-ink-100">Maturity bands</span> use raw 25/50/75
            percentiles on the current snapshot.
          </li>
          <li>
            <span className="text-ink-100">Inventory value</span> sums all
            currently-live, priced listings per seller — a rough proxy for
            &quot;skin in the market&quot; right now.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
