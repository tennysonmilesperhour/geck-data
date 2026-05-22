// Per-trait entity page. Slug is slugifyTrait(name), e.g. "lilly-white".
//
// Sections:
//   - State strip: live count, median ask, sold count, frequency rank.
//   - Combos that include this trait (links to /combo/[slug]).
//   - Current listings.
//   - Recent sold history.
//   - Top sellers by inventory in this trait.
//
// Trait identity is fuzzy by design: we match on substring of
// cached_traits / norm_traits, then dedupe combos against
// HIGH_VALUE_COMBOS to surface the canonical anchors.
import Link from "next/link";
import { notFound } from "next/navigation";
import { HIGH_VALUE_COMBOS } from "@/lib/market/combos";
import { parseFilters, serverHref } from "@/lib/filters/link";
import { slugifyTrait, unslugTrait } from "@/lib/filters/schema";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtUsd } from "@/lib/format";
import { Panel, SectionHeader, StatusPill } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import DataTable, { type Column } from "@/components/ui/DataTable";
import MiniSparkline from "@/components/charts/MiniSparkline";
import WatchButton from "@/components/alerts/WatchButton";
import SourceFootnote from "@/components/ui/SourceFootnote";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type ListingRow = {
  id: string;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  cached_traits: string | null;
  seller_id: string | null;
  seller_name: string | null;
  seller_location: string | null;
  maturity: string | null;
  sex: string | null;
};

type SoldRow = {
  id: string;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  sold_at: string | null;
  days_to_sell: number | null;
  seller_name: string | null;
  cached_traits: string | null;
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

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const trait = unslugTrait(params.slug);
  return {
    title: `${trait} - Geck Inspect Market`,
    description: `Listings and combos featuring ${trait}.`,
  };
}

export default async function TraitPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: SearchParams;
}) {
  const slug = params.slug;
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  const traitName = unslugTrait(slug);
  const ilikePattern = `%${traitName}%`;

  const filters = parseFilters(searchParams);
  const supabase = createClient();

  const [liveRes, soldRes] = await Promise.all([
    supabase
      .from("market_listings")
      .select(
        "id, title, price, price_usd_equivalent, cached_traits, seller_id, seller_name, seller_location, maturity, sex, current_status",
      )
      .eq("current_status", "live")
      .or(`cached_traits.ilike.${ilikePattern},norm_traits.ilike.${ilikePattern}`)
      .limit(1500),
    supabase
      .from("sold_listings_v")
      .select(
        "id, title, price, price_usd_equivalent, cached_traits, sold_at, days_to_sell, seller_name",
      )
      .or(`cached_traits.ilike.${ilikePattern}`)
      .order("sold_at", { ascending: false })
      .limit(300),
  ]);

  const liveAll = (liveRes.data ?? []) as ListingRow[];
  const soldRows = (soldRes.data ?? []) as SoldRow[];

  const liveFiltered = liveAll.filter((r) => {
    if (filters.region !== "ALL") {
      const loc = (r.seller_location ?? "").toUpperCase();
      if (filters.region === "US" && !/USA?|UNITED STATES/.test(loc)) return false;
      if (filters.region === "EU" && !/EU|GERMANY|FRANCE|SPAIN|ITALY|NETHERLANDS|BELGIUM|POLAND/.test(loc)) return false;
      if (filters.region === "UK" && !/UK|UNITED KINGDOM|ENGLAND|SCOTLAND|WALES/.test(loc)) return false;
      if (filters.region === "CA" && !/CANADA/.test(loc)) return false;
      if (filters.region === "AU" && !/AUSTRALIA/.test(loc)) return false;
    }
    if (filters.sex !== "any" && (r.sex ?? "").toLowerCase() !== filters.sex) return false;
    const p = priceOf(r);
    if (filters.priceMin != null && (p == null || p < filters.priceMin)) return false;
    if (filters.priceMax != null && (p == null || p > filters.priceMax)) return false;
    return true;
  });

  const livePrices = liveFiltered.map(priceOf).filter((p): p is number => p != null);
  const soldPrices = soldRows.map(priceOf).filter((p): p is number => p != null);
  const medianAsk = median(livePrices) ?? 0;
  const medianSold = median(soldPrices) ?? 0;

  // Find anchor combos that include this trait.
  const matchingCombos = HIGH_VALUE_COMBOS.filter((c) =>
    c.traits.some((t) => slugifyTrait(t) === slug || t.toLowerCase() === traitName.toLowerCase()),
  );

  // Top sellers in this trait.
  const sellerMap = new Map<string, { id: string; name: string; loc: string | null; n: number }>();
  for (const r of liveFiltered) {
    if (!r.seller_id) continue;
    const cur = sellerMap.get(r.seller_id) ?? {
      id: r.seller_id,
      name: r.seller_name ?? r.seller_id,
      loc: r.seller_location ?? null,
      n: 0,
    };
    cur.n += 1;
    sellerMap.set(r.seller_id, cur);
  }
  const topSellers = Array.from(sellerMap.values())
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  // Weekly sold count over 26 weeks for a freq sparkline.
  const buckets = new Map<string, number>();
  for (const r of soldRows) {
    if (!r.sold_at) continue;
    const d = new Date(r.sold_at);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (day - 1));
    d.setUTCHours(0, 0, 0, 0);
    const k = d.toISOString().slice(0, 10);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  const freqSpark = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-26)
    .map(([, v]) => v);

  const liveCols: Column<ListingRow>[] = [
    {
      key: "title",
      header: "Listing",
      render: (r) => (
        <Link href={`/listings/${r.id}`} className="text-ink-100 hover:text-claude-glow">
          {r.title ?? r.id}
        </Link>
      ),
    },
    {
      key: "seller",
      header: "Seller",
      render: (r) =>
        r.seller_id ? (
          <Link
            href={serverHref(`/sellers/${r.seller_id}`, searchParams, {
              traits: [slug],
            })}
            className="text-ink-300 hover:text-claude-glow"
          >
            {r.seller_name ?? r.seller_id}
          </Link>
        ) : (
          <span className="text-ink-500">—</span>
        ),
    },
    {
      key: "loc",
      header: "Location",
      render: (r) => <span className="text-ink-400">{r.seller_location ?? "—"}</span>,
    },
    {
      key: "maturity",
      header: "Age",
      render: (r) => <span className="text-ink-400 capitalize">{r.maturity ?? "—"}</span>,
    },
    {
      key: "price",
      header: "Ask",
      align: "right",
      render: (r) => {
        const p = priceOf(r);
        return <span className="font-mono tabular-nums">{p ? fmtUsd(p) : "—"}</span>;
      },
    },
  ];

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Trait / Entity"
        title={traitName}
        description="Listings and combos that include this trait. Trait matching is fuzzy on cached trait text; the combos panel anchors known canonical groupings."
        right={
          <div className="flex items-center gap-2">
            <StatusPill status="info" label={slug} />
            <WatchButton
              label="Watch trait"
              alertName={`${traitName} watch`}
              query={{ kind: "morph", term: traitName }}
            />
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Live listings" value={fmtInt(liveFiltered.length)} sub="active, matches trait" />
        <KpiCard label="Median ask" value={medianAsk ? fmtUsd(medianAsk) : "—"} sub="from filtered set" />
        <KpiCard label="Sold (180d)" value={fmtInt(soldRows.length)} sub="recent comps" tone="positive" />
        <KpiCard label="Median sold" value={medianSold ? fmtUsd(medianSold) : "—"} sub="recent comps" />
      </section>

      {freqSpark.length > 1 && (
        <Panel title="Sold cadence" subtitle="Weekly sold count over the last 26 weeks for any listing whose traits include this one.">
          <MiniSparkline values={freqSpark} width={420} height={56} fill />
        </Panel>
      )}

      {matchingCombos.length > 0 && (
        <Panel
          title="Anchor combos featuring this trait"
          subtitle="Canonical high-value combos that include this trait. Click through to see each combo's full picture."
        >
          <div className="flex flex-wrap gap-2">
            {matchingCombos.map((c) => (
              <Link
                key={c.id}
                href={serverHref(`/combo/${c.id}`, searchParams)}
                className="rounded-full border border-forest-700 bg-forest-950/60 px-3 py-1 text-sm text-ink-100 hover:border-claude/40 hover:text-claude-glow"
              >
                {c.display}
              </Link>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Current listings"
        subtitle="Live MorphMarket listings whose traits contain this one."
        padded={false}
      >
        <DataTable
          columns={liveCols}
          rows={liveFiltered.slice(0, 50)}
          rowKey={(r) => r.id}
          emptyMessage="No live listings match this trait under the current filters."
        />
      </Panel>

      {topSellers.length > 0 && (
        <Panel title="Top sellers in this trait" subtitle="By live listing count." padded={false}>
          <ul className="divide-y divide-ink-700/40">
            {topSellers.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <Link
                  href={serverHref(`/sellers/${s.id}`, searchParams, { traits: [slug] })}
                  className="text-ink-100 hover:text-claude-glow"
                >
                  {s.name}
                </Link>
                <span className="text-xs text-ink-400">{s.loc ?? ""}</span>
                <span className="font-mono tabular-nums text-ink-300">{fmtInt(s.n)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <SourceFootnote
        sources={["market_listings (trait substring match)", "sold_listings_v"]}
        n={liveFiltered.length + soldRows.length}
        methodologyAnchor="sub-index"
      />
    </div>
  );
}
