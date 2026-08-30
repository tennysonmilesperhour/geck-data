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
import { parseFilters, serverHref } from "@/lib/filters/link";
import { unslugTrait } from "@/lib/filters/schema";
import {
  resolveTraitName,
  comboSlugFromId,
} from "@/lib/market/combo-slug";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtUsd } from "@/lib/format";
import { Panel, SectionHeader, StatusPill } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import DataTable, { type Column } from "@/components/ui/DataTable";
import MiniSparkline from "@/components/charts/MiniSparkline";
import WatchButton from "@/components/alerts/WatchButton";
import SourceFootnote from "@/components/ui/SourceFootnote";
import {
  isRedundantComboName,
  redundantComboKeys,
} from "@/lib/market/combo-redundancy";
import ListingImage from "@/components/media/ListingImage";
import SellerAvatar from "@/components/media/SellerAvatar";
import {
  getListingImageMap,
  getSellerVisualMap,
} from "@/lib/media/market-images";

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
  cached_traits: string | null;
  // 'captured_event' means the pipeline watched the listing flip to sold.
  // 'inferred_unseen' means the catalogue walk stopped seeing it and a sale
  // is inferred. Different evidence, so it travels with the row.
  sold_basis: string | null;
  is_group_lot: boolean | null;
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

  const filters = parseFilters(searchParams);
  const supabase = createClient();

  // Resolve slug to the trait name as it actually appears in
  // cached_traits. The naive unslug returns "Tri Color" for the slug
  // "tri-color" but the database stores it as "Tri-color"; matching
  // against the canonical form is the difference between rendering
  // zero listings and rendering ~100.
  const { trait: traitName, canonical } = await resolveTraitName(
    supabase,
    slug,
  );
  const ilikePattern = `%${traitName}%`;

  const [liveRes, soldRes] = await Promise.all([
    supabase
      .from("market_listings")
      .select(
        "id, title, price, price_usd_equivalent, cached_traits, seller_id, seller_name, seller_location, maturity, sex, current_status",
      )
      .eq("current_status", "live")
      .or(`cached_traits.ilike.${ilikePattern},norm_traits.ilike.${ilikePattern}`)
      .limit(1500),
    // v_sold_reconciled (migration 0045) instead of sold_listings_v: the old
    // view joined only listing_status_events, which is 92 rows from four days
    // in May, and silently omitted the 2,840 inferred sales from May and June.
    // Both pools come back here carrying sold_basis so nothing is merged
    // without saying so. Group lots price several animals at once, so they
    // cannot sit in a per-animal comp.
    supabase
      .from("v_sold_reconciled")
      .select(
        "id, title, price, price_usd_equivalent, cached_traits, sold_at, days_to_sell, sold_basis, is_group_lot",
      )
      .or(`cached_traits.ilike.${ilikePattern}`)
      .eq("is_group_lot", false)
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
  const newestSoldAt = soldRows.find((r) => r.sold_at)?.sold_at ?? null;

  // Find every observed combo that includes this trait, ranked by
  // sample size. Pulls from v_observed_combos (auto-discovered, ~350
  // combos) instead of the legacy 12-row HIGH_VALUE_COMBOS list.
  const [{ data: comboRowsRaw }, { data: breadthRows }] = await Promise.all([
    supabase
      .from("v_observed_combos")
      .select("combo_name, n, median_price")
      .ilike("combo_name", `%${traitName}%`)
      .order("n", { ascending: false })
      .limit(40),
    supabase
      .from("v_combo_breadth")
      .select("combo_id, is_redundant_pair")
      .eq("is_redundant_pair", true)
      .limit(2000),
  ]);
  const redundantKeys = redundantComboKeys(breadthRows ?? []);
  const matchingCombos = (
    (comboRowsRaw ?? []) as Array<{
      combo_name: string;
      n: number | string;
      median_price: number | string | null;
    }>
  )
    .filter((c) => !isRedundantComboName(c.combo_name, redundantKeys))
    .slice(0, 20);

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
  const [listingImages, sellerVisuals] = await Promise.all([
    getListingImageMap(
      supabase,
      liveFiltered.slice(0, 50).map((row) => row.id),
    ),
    getSellerVisualMap(
      supabase,
      topSellers.map((seller) => seller.id),
    ),
  ]);

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
      width: "38%",
      render: (r) => (
        <Link
          href={`/listings/${r.id}`}
          className="group inline-flex min-w-0 items-center gap-3 text-ink-100 hover:text-claude-glow"
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
          <span className="truncate">{r.title ?? r.id}</span>
        </Link>
      ),
    },
    {
      key: "seller",
      header: "Seller",
      width: "22%",
      render: (r) =>
        r.seller_name || r.seller_id ? (
          <Link
            href={serverHref(`/sellers/${r.seller_id ?? ""}`, searchParams, {
              traits: [slug],
            })}
            className="block truncate text-ink-100 hover:text-claude-glow"
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
      width: "18%",
      render: (r) => (
        <span className="block truncate text-ink-300">
          {r.seller_location ?? "no data"}
        </span>
      ),
    },
    {
      key: "maturity",
      header: "Age",
      width: "10%",
      render: (r) => (
        <span className="text-ink-300 capitalize">{r.maturity ?? "no data"}</span>
      ),
    },
    {
      key: "price",
      header: "Ask",
      align: "right",
      width: "12%",
      render: (r) => {
        const p = priceOf(r);
        return <span className="font-mono tabular-nums text-ink-100">{p ? fmtUsd(p) : "no data"}</span>;
      },
    },
  ];

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Trait / Entity"
        title={traitName}
        description={
          canonical
            ? `Listings and combos that include "${traitName}". Trait name resolved from v_observed_traits; matching uses substring on cached_traits.`
            : `Listings and combos that include this trait. Trait name "${traitName}" was inferred from the slug (no canonical match in v_observed_traits); matching uses substring on cached_traits.`
        }
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
        <KpiCard label="Median ask" value={medianAsk ? fmtUsd(medianAsk) : "no data"} sub="from filtered set" />
        <KpiCard
          label="Recorded sales"
          value={fmtInt(soldRows.length)}
          sub={
            newestSoldAt
              ? `newest ${newestSoldAt.slice(0, 10)}${soldRows.length >= 300 ? ", newest 300 shown" : ""}`
              : "none recorded"
          }
          tone="positive"
        />
        <KpiCard
          label="Median recorded price"
          value={medianSold ? fmtUsd(medianSold) : "no data"}
          sub="last observed ask, not a negotiated price"
        />
      </section>

      {freqSpark.length > 1 && (
        <Panel title="Sold cadence" subtitle="Weekly sold count over the last 26 weeks for any listing whose traits include this one.">
          <MiniSparkline values={freqSpark} width={420} height={56} fill />
        </Panel>
      )}

      {matchingCombos.length > 0 && (
        <Panel
          title="Combos featuring this trait"
          subtitle={`Every observed two-trait combination that includes "${traitName}", ranked by sample size. Click any chip to land on the combo page.`}
        >
          <div className="flex flex-wrap gap-2">
            {matchingCombos.map((c) => {
              const slug = comboSlugFromId(c.combo_name);
              const n = Number(c.n ?? 0);
              const median = Number(c.median_price ?? 0);
              return (
                <Link
                  key={c.combo_name}
                  href={serverHref(`/combo/${slug}`, searchParams)}
                  className="rounded-full border border-forest-700 bg-forest-950/60 px-3 py-1 text-sm text-ink-100 hover:border-claude/40 hover:text-claude-glow"
                  title={`${n} listings · median $${Math.round(median).toLocaleString()}`}
                >
                  {c.combo_name}
                  <span className="ml-1.5 font-mono text-[10px] text-ink-500">
                    {n}
                  </span>
                </Link>
              );
            })}
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
              <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm">
                <Link
                  href={serverHref(`/sellers/${s.id}`, searchParams, { traits: [slug] })}
                  className="inline-flex min-w-0 items-center gap-3 text-ink-100 hover:text-claude-glow"
                >
                  <SellerAvatar
                    name={s.name}
                    imageUrl={sellerVisuals.get(s.id)?.avatarUrl}
                    size={36}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{s.name}</span>
                    <span className="block truncate text-xs text-ink-400">
                      {s.loc ?? "Location not reported"}
                    </span>
                  </span>
                </Link>
                <span className="font-mono tabular-nums text-ink-300">{fmtInt(s.n)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <SourceFootnote
        sources={["market_listings (trait substring match)", "v_sold_reconciled"]}
        n={liveFiltered.length + soldRows.length}
        methodologyAnchor="sub-index"
      />
    </div>
  );
}
