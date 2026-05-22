// Per-region entity page. Code is one of REGIONS (US, EU, UK, CA, AU,
// JP, SE, SEA). Aggregates everything we know about activity in
// that region: top combos by live count, median ask, velocity, top
// sellers.
//
// Region inference is location-string based and lives in src/lib/market
// for reuse on /combo/[slug]. Imperfect but consistent with how the
// existing Geographic widgets bucket sellers.
import Link from "next/link";
import { notFound } from "next/navigation";
import { REGIONS, type Region } from "@/lib/market/types";
import { HIGH_VALUE_COMBOS, matchCombo } from "@/lib/market/combos";
import { parseFilters, serverHref } from "@/lib/filters/link";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtUsd } from "@/lib/format";
import { Panel, SectionHeader, StatusPill } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import DataTable, { type Column } from "@/components/ui/DataTable";

export const dynamic = "force-dynamic";

const REGION_LABEL: Record<Region, string> = {
  ALL: "All regions",
  US: "United States",
  EU: "Europe",
  UK: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  JP: "Japan",
  SE: "Scandinavia",
  SEA: "Southeast Asia",
};

const REGION_PATTERNS: Record<string, RegExp> = {
  US: /USA?|UNITED STATES|U\.S\./,
  CA: /CANADA|\bON\b|\bBC\b|\bQC\b/,
  UK: /UNITED KINGDOM|\bUK\b|ENGLAND|SCOTLAND|WALES/,
  EU: /GERMANY|FRANCE|SPAIN|ITALY|NETHERLANDS|BELGIUM|POLAND|SWITZERLAND|AUSTRIA|EU\b/,
  AU: /AUSTRALIA|\bAU\b/,
  JP: /JAPAN/,
  SE: /SWEDEN|NORWAY|FINLAND|DENMARK/,
  SEA: /SINGAPORE|MALAYSIA|THAILAND|VIETNAM|PHILIPPINES|INDONESIA/,
};

function locMatches(region: Region, loc: string | null | undefined): boolean {
  if (region === "ALL") return true;
  if (!loc) return false;
  const pattern = REGION_PATTERNS[region];
  return pattern ? pattern.test(loc.toUpperCase()) : false;
}

type ListingRow = {
  id: string;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  cached_traits: string | null;
  seller_id: string | null;
  seller_name: string | null;
  seller_location: string | null;
  current_status: string | null;
};

type SoldRow = {
  id: string;
  price: number | null;
  price_usd_equivalent: number | null;
  cached_traits: string | null;
  sold_at: string | null;
  days_to_sell: number | null;
  seller_name: string | null;
};

function priceOf(r: { price: number | null; price_usd_equivalent: number | null }): number | null {
  const p = r.price_usd_equivalent ?? r.price;
  return p && p > 0 && p < 100_000 ? p : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}

export async function generateMetadata({ params }: { params: { code: string } }) {
  const code = params.code.toUpperCase() as Region;
  if (!REGIONS.includes(code)) return { title: "Region not found" };
  return {
    title: `${REGION_LABEL[code]} - Geck Inspect Market`,
    description: `Crested gecko market activity in ${REGION_LABEL[code]}.`,
  };
}

export default async function RegionPage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const code = params.code.toUpperCase() as Region;
  if (!REGIONS.includes(code) || code === "ALL") notFound();
  const filters = parseFilters(searchParams);

  const supabase = createClient();
  const [liveRes, soldRes, sellersRes] = await Promise.all([
    supabase
      .from("market_listings")
      .select(
        "id, title, price, price_usd_equivalent, cached_traits, seller_id, seller_name, seller_location, current_status",
      )
      .eq("current_status", "live")
      .limit(8000),
    supabase
      .from("sold_listings_v")
      .select(
        "id, price, price_usd_equivalent, cached_traits, sold_at, days_to_sell, seller_name",
      )
      .order("sold_at", { ascending: false })
      .limit(3000),
    supabase
      .from("market_sellers")
      .select(
        "seller_id, seller_name, seller_location, total_listings, avg_price, feedback_count",
      )
      .limit(3000),
  ]);

  const liveAll = (liveRes.data ?? []) as ListingRow[];
  const soldAll = (soldRes.data ?? []) as SoldRow[];
  const sellersAll = (sellersRes.data ?? []) as Array<{
    seller_id: string;
    seller_name: string | null;
    seller_location: string | null;
    total_listings: number | null;
    avg_price: number | null;
    feedback_count: number | null;
  }>;

  const live = liveAll.filter((r) => locMatches(code, r.seller_location));
  const sold = soldAll.filter((r) => {
    // We do not have seller_location on sold_listings_v directly; we
    // approximate via the sellers table later when ranking sellers,
    // but the sold totals here are global until we wire the join.
    return true;
  });
  const sellers = sellersAll.filter((s) => locMatches(code, s.seller_location));

  // Top combos in this region by live count.
  const comboCount = new Map<string, { combo: typeof HIGH_VALUE_COMBOS[number]; n: number; prices: number[] }>();
  for (const r of live) {
    const combo = matchCombo(r.cached_traits);
    if (!combo) continue;
    const cur = comboCount.get(combo.id) ?? { combo, n: 0, prices: [] };
    cur.n += 1;
    const p = priceOf(r);
    if (p != null) cur.prices.push(p);
    comboCount.set(combo.id, cur);
  }
  const topCombos = Array.from(comboCount.values())
    .sort((a, b) => b.n - a.n)
    .slice(0, 12);

  const livePrices = live.map(priceOf).filter((p): p is number => p != null);
  const medianAsk = median(livePrices) ?? 0;

  // Top sellers in region by inventory.
  const topSellers = sellers
    .slice()
    .sort((a, b) => (b.total_listings ?? 0) - (a.total_listings ?? 0))
    .slice(0, 12);

  const comboCols: Column<typeof topCombos[number]>[] = [
    {
      key: "combo",
      header: "Combo",
      render: (row) => (
        <Link
          href={serverHref(`/combo/${row.combo.id}`, searchParams, { region: code })}
          className="text-ink-100 hover:text-claude-glow"
        >
          {row.combo.display}
        </Link>
      ),
    },
    {
      key: "count",
      header: "Live",
      align: "right",
      render: (row) => <span className="font-mono tabular-nums">{fmtInt(row.n)}</span>,
    },
    {
      key: "median",
      header: "Median ask",
      align: "right",
      render: (row) => {
        const m = median(row.prices) ?? null;
        return <span className="font-mono tabular-nums">{m ? fmtUsd(m) : "—"}</span>;
      },
    },
  ];

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Region / Entity"
        title={REGION_LABEL[code]}
        description={`Live activity in ${REGION_LABEL[code]} based on seller-location strings. Imprecise; treat as a directional read, not a customs report.`}
        right={<StatusPill status="info" label={code} />}
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Live listings" value={fmtInt(live.length)} sub={`of ${fmtInt(liveAll.length)} global`} />
        <KpiCard label="Median ask" value={medianAsk ? fmtUsd(medianAsk) : "—"} sub="USD" />
        <KpiCard label="Sellers" value={fmtInt(sellers.length)} sub={`of ${fmtInt(sellersAll.length)} known`} />
        <KpiCard label="Anchor combos here" value={fmtInt(comboCount.size)} sub={`of ${HIGH_VALUE_COMBOS.length}`} tone="info" />
      </section>

      <Panel
        title="Top combos in this region"
        subtitle="Ranked by live listing count. Anchor combos only; non-anchor listings do not appear here but still count in the region totals above."
        padded={false}
      >
        <DataTable columns={comboCols} rows={topCombos} rowKey={(r) => r.combo.id} emptyMessage="No anchor combos live in this region right now." />
      </Panel>

      <Panel
        title="Top sellers in this region"
        subtitle="By total live listings (across all combos)."
        padded={false}
      >
        <ul className="divide-y divide-ink-700/40">
          {topSellers.length === 0 ? (
            <li className="p-4 text-sm text-ink-400">No sellers known in this region.</li>
          ) : (
            topSellers.map((s) => (
              <li key={s.seller_id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <Link
                  href={serverHref(`/sellers/${s.seller_id}`, searchParams, { region: code })}
                  className="text-ink-100 hover:text-claude-glow"
                >
                  {s.seller_name ?? s.seller_id}
                </Link>
                <span className="text-xs text-ink-400">{s.seller_location ?? ""}</span>
                <span className="font-mono tabular-nums text-ink-300">{fmtInt(s.total_listings)}</span>
                <span className="font-mono tabular-nums text-ink-400">{s.avg_price ? fmtUsd(s.avg_price) : "—"}</span>
              </li>
            ))
          )}
        </ul>
      </Panel>
    </div>
  );
}
