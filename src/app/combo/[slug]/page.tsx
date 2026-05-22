// Per-combo entity page. The slug matches HIGH_VALUE_COMBOS[].id.
//
// What we show, top to bottom:
//   - State strip: median ask, live count, sold count (180d),
//     sold-to-ask spread, days to sell.
//   - Price history sparkline (180d, weekly).
//   - Current listings table (live, filtered to combo + filters).
//   - Sold history table (sold, last 180d, filtered to combo).
//   - Regional spread: per-region live count + median ask.
//
// Reads the canonical filter schema from searchParams so links from
// other pages preserve context (region, age, sex, price band).
import Link from "next/link";
import { notFound } from "next/navigation";
import { HIGH_VALUE_COMBOS, type CanonicalCombo } from "@/lib/market/combos";
import { parseFilters, serverHref } from "@/lib/filters/link";
import { slugifyTrait } from "@/lib/filters/schema";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtUsd } from "@/lib/format";
import { Panel, SectionHeader, StatusPill } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import DataTable, { type Column } from "@/components/ui/DataTable";
import MiniSparkline from "@/components/charts/MiniSparkline";
import WatchButton from "@/components/alerts/WatchButton";
import { anchorOf, paletteFor } from "@/lib/market/anchors";
import SourceFootnote from "@/components/ui/SourceFootnote";
import CsvDownloadButton from "@/components/ui/CsvDownloadButton";

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
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type SoldRow = {
  id: string;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  sold_at: string | null;
  days_to_sell: number | null;
  seller_name: string | null;
  url: string | null;
};

type PriceRow = { observed_at: string; price_usd_equivalent: number | null; price: number | null };

const REGION_CODES = ["US", "EU", "UK", "CA", "AU", "JP", "SE", "SEA"] as const;

function inferRegion(loc: string | null | undefined): string {
  if (!loc) return "OTHER";
  const upper = loc.toUpperCase();
  if (/\bUSA?\b|UNITED STATES|U\.S\./.test(upper)) return "US";
  if (/CANADA|\bON\b|\bBC\b|\bQC\b/.test(upper)) return "CA";
  if (/UNITED KINGDOM|\bUK\b|ENGLAND|SCOTLAND|WALES/.test(upper)) return "UK";
  if (/GERMANY|FRANCE|SPAIN|ITALY|NETHERLANDS|BELGIUM|POLAND|SWITZERLAND|AUSTRIA|EU/.test(upper))
    return "EU";
  if (/AUSTRALIA|\bAU\b/.test(upper)) return "AU";
  if (/JAPAN/.test(upper)) return "JP";
  if (/SWEDEN|NORWAY|FINLAND|DENMARK/.test(upper)) return "SE";
  if (/SINGAPORE|MALAYSIA|THAILAND|VIETNAM|PHILIPPINES|INDONESIA/.test(upper))
    return "SEA";
  return "OTHER";
}

function priceOf(r: { price: number | null; price_usd_equivalent: number | null }): number | null {
  const p = r.price_usd_equivalent ?? r.price;
  return p && p > 0 && p < 100_000 ? p : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}

function weeklyMedianSeries(rows: PriceRow[]): number[] {
  if (rows.length === 0) return [];
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const p = priceOf(r);
    if (p == null || !r.observed_at) continue;
    const d = new Date(r.observed_at);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (day - 1));
    d.setUTCHours(0, 0, 0, 0);
    const k = d.toISOString().slice(0, 10);
    const arr = buckets.get(k) ?? [];
    arr.push(p);
    buckets.set(k, arr);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, vals]) => median(vals) ?? 0);
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const combo = HIGH_VALUE_COMBOS.find((c) => c.id === params.slug);
  if (!combo) return { title: "Combo not found" };
  return {
    title: `${combo.display} - Geck Inspect Market`,
    description: `Price history, current listings, and recent sales for ${combo.display}.`,
  };
}

export default async function ComboPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: SearchParams;
}) {
  const combo: CanonicalCombo | undefined = HIGH_VALUE_COMBOS.find(
    (c) => c.id === params.slug,
  );
  if (!combo) notFound();

  const filters = parseFilters(searchParams);
  const supabase = createClient();

  // Build the combo trait filter as chained ILIKEs (postgrest ANDs them).
  let liveQuery = supabase
    .from("market_listings")
    .select(
      "id, title, price, price_usd_equivalent, cached_traits, seller_id, seller_name, seller_location, maturity, sex, first_seen_at, last_seen_at, current_status",
    )
    .eq("current_status", "live")
    .limit(800);
  for (const t of combo.traits) {
    liveQuery = liveQuery.ilike("cached_traits", `%${t}%`);
  }

  let soldQuery = supabase
    .from("sold_listings_v")
    .select(
      "id, title, price, price_usd_equivalent, cached_traits, sold_at, days_to_sell, seller_name, source_url",
    )
    .order("sold_at", { ascending: false })
    .limit(200);
  for (const t of combo.traits) {
    soldQuery = soldQuery.ilike("cached_traits", `%${t}%`);
  }

  // Price history for the price chart: pull recent ticks for listings
  // that matched the combo via a join helper. We do a two-step: find
  // the listing ids first, then pull price_history for those.
  const [liveRes, soldRes] = await Promise.all([liveQuery, soldQuery]);
  const liveRows = (liveRes.data ?? []) as ListingRow[];
  const soldRows = (soldRes.data ?? []) as Array<
    SoldRow & { cached_traits: string | null; source_url: string | null }
  >;

  // Apply server-side canonical filters (region/age/sex/price band)
  // on the live list. We do not narrow the sold history by region;
  // it stays a global price comp picture.
  const filteredLive = liveRows.filter((r) => {
    if (filters.region !== "ALL") {
      if (inferRegion(r.seller_location) !== filters.region) return false;
    }
    if (filters.age !== "any") {
      const m = (r.maturity ?? "").toLowerCase();
      if (filters.age === "juvenile" && !m.startsWith("juv")) return false;
      if (filters.age === "subadult" && !m.startsWith("sub")) return false;
      if (filters.age === "adult" && !m.startsWith("adult")) return false;
    }
    if (filters.sex !== "any") {
      if ((r.sex ?? "").toLowerCase() !== filters.sex) return false;
    }
    const p = priceOf(r);
    if (filters.priceMin != null && (p == null || p < filters.priceMin)) return false;
    if (filters.priceMax != null && (p == null || p > filters.priceMax)) return false;
    return true;
  });

  const liveIds = filteredLive.slice(0, 200).map((r) => r.id);
  const priceTicks: PriceRow[] =
    liveIds.length === 0
      ? []
      : await supabase
          .from("price_history")
          .select("observed_at, price, price_usd_equivalent")
          .in("listing_id", liveIds)
          .gte("observed_at", new Date(Date.now() - 180 * 86400_000).toISOString())
          .limit(4000)
          .then(({ data }) => (data ?? []) as PriceRow[]);

  // Aggregates.
  const livePrices = filteredLive.map(priceOf).filter((p): p is number => p != null);
  const soldPrices = soldRows.map(priceOf).filter((p): p is number => p != null);
  const medianAsk = median(livePrices) ?? 0;
  const medianSold = median(soldPrices) ?? 0;
  const days = soldRows.map((r) => r.days_to_sell).filter((d): d is number => typeof d === "number");
  const medianDays = median(days) ?? 0;
  const spreadPct =
    medianSold > 0 ? Math.round(((medianAsk - medianSold) / medianSold) * 100) : null;

  const priceSpark = weeklyMedianSeries([
    ...priceTicks,
    ...soldRows.map((r) => ({
      observed_at: r.sold_at ?? "",
      price: r.price,
      price_usd_equivalent: r.price_usd_equivalent,
    })),
  ]).slice(-26);

  // Top sellers in this combo.
  const sellerCount = new Map<string, { id: string; name: string; loc: string | null; n: number }>();
  for (const r of filteredLive) {
    if (!r.seller_id) continue;
    const cur = sellerCount.get(r.seller_id) ?? {
      id: r.seller_id,
      name: r.seller_name ?? r.seller_id,
      loc: r.seller_location ?? null,
      n: 0,
    };
    cur.n += 1;
    sellerCount.set(r.seller_id, cur);
  }
  const topSellers = Array.from(sellerCount.values())
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);

  // Regional spread.
  const byRegion = new Map<string, number[]>();
  for (const r of filteredLive) {
    const reg = inferRegion(r.seller_location);
    const arr = byRegion.get(reg) ?? [];
    const p = priceOf(r);
    if (p != null) arr.push(p);
    byRegion.set(reg, arr);
  }

  // Build the columns. We expose links that preserve canonical filters.
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
            href={serverHref(`/sellers/${r.seller_id}`, searchParams, { combos: [combo.id] })}
            className="text-ink-300 hover:text-claude-glow"
          >
            {r.seller_name ?? r.seller_id}
          </Link>
        ) : (
          <span className="text-ink-500">—</span>
        ),
    },
    {
      key: "maturity",
      header: "Age",
      render: (r) => <span className="text-ink-400 capitalize">{r.maturity ?? "—"}</span>,
    },
    {
      key: "sex",
      header: "Sex",
      render: (r) => <span className="text-ink-400 capitalize">{r.sex ?? "—"}</span>,
    },
    {
      key: "price",
      header: "Ask",
      align: "right",
      render: (r) => {
        const p = priceOf(r);
        if (p == null) return <span className="text-ink-500">—</span>;
        const verdict = medianSold > 0 ? p / medianSold : null;
        const dealClass =
          verdict == null
            ? ""
            : verdict <= 0.9
              ? "text-ready"
              : verdict >= 1.3
                ? "text-danger"
                : "";
        return (
          <span className={`font-mono tabular-nums ${dealClass}`} title={
            verdict
              ? `${Math.round(verdict * 100)}% of combo median sold`
              : undefined
          }>
            {fmtUsd(p)}
          </span>
        );
      },
    },
  ];

  const soldCols: Column<SoldRow>[] = [
    {
      key: "title",
      header: "Listing",
      render: (r) =>
        r.url ? (
          <a href={r.url} target="_blank" rel="noreferrer" className="text-ink-100 hover:text-claude-glow">
            {r.title ?? r.id}
          </a>
        ) : (
          <Link href={`/listings/${r.id}`} className="text-ink-100 hover:text-claude-glow">
            {r.title ?? r.id}
          </Link>
        ),
    },
    {
      key: "seller",
      header: "Seller",
      render: (r) => <span className="text-ink-300">{r.seller_name ?? "—"}</span>,
    },
    {
      key: "sold_at",
      header: "Sold",
      render: (r) => (
        <span className="text-ink-400">
          {r.sold_at ? new Date(r.sold_at).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "days",
      header: "Days",
      align: "right",
      render: (r) => (
        <span className="font-mono tabular-nums text-ink-300">
          {r.days_to_sell != null ? `${r.days_to_sell}d` : "—"}
        </span>
      ),
    },
    {
      key: "price",
      header: "Sold price",
      align: "right",
      render: (r) => {
        const p = priceOf(r);
        return (
          <span className="font-mono tabular-nums">{p ? fmtUsd(p) : "—"}</span>
        );
      },
    },
  ];

  const anchorPalette = paletteFor(
    anchorOf(combo.display) ?? anchorOf(combo.traits.join(" ")),
  );

  return (
    <div className="page-rise space-y-8">
      {anchorPalette ? (
        <div
          className="rounded-xl border border-ink-700/60 px-4 py-3"
          style={{
            backgroundImage: `linear-gradient(120deg, ${anchorPalette.soft} 0%, transparent 70%)`,
            borderLeft: `4px solid ${anchorPalette.hex}`,
          }}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className="font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{ color: anchorPalette.text }}
            >
              Anchor family
            </span>
            <span className="text-sm text-ink-100">{anchorPalette.key}</span>
          </div>
        </div>
      ) : null}
      <SectionHeader
        eyebrow="Combo / Entity"
        title={combo.display}
        description={
          <>
            {combo.traits.map((t, i) => (
              <span key={t}>
                {i > 0 ? " × " : ""}
                <Link
                  href={serverHref(`/trait/${slugifyTrait(t)}`, searchParams)}
                  className="underline decoration-ink-700 underline-offset-2 hover:text-claude-glow"
                >
                  {t}
                </Link>
              </span>
            ))}
            <span className="ml-3 text-ink-500">— current state and recent comparables.</span>
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <StatusPill status="info" label={`combo_id ${combo.id}`} />
            <WatchButton
              label="Watch combo"
              alertName={`${combo.display} watch`}
              query={{ kind: "combo", combo: combo.name }}
            />
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Median ask" value={medianAsk ? fmtUsd(medianAsk) : "—"} sub={`${fmtInt(livePrices.length)} live`} />
        <KpiCard label="Median sold" value={medianSold ? fmtUsd(medianSold) : "—"} sub={`${fmtInt(soldPrices.length)} sold (180d)`} tone="positive" />
        <KpiCard
          label="Ask vs sold"
          value={spreadPct == null ? "—" : `${spreadPct >= 0 ? "+" : ""}${spreadPct}%`}
          tone={spreadPct != null && spreadPct > 25 ? "negative" : "default"}
          sub={spreadPct == null ? "no sold comps" : "ask above sold median"}
        />
        <KpiCard label="Live count" value={fmtInt(filteredLive.length)} sub="this combo + filters" />
        <KpiCard label="Median days to sell" value={medianDays ? `${medianDays}d` : "—"} sub="from sold-history" />
      </section>

      <Panel
        title="Price history"
        subtitle="Weekly median of price_history ticks + sold events for this combo, last 26 weeks. Sparkline is a directional read; the listings tables below have exact numbers."
        right={
          <span className="font-mono text-[11px] text-ink-500">
            {priceSpark.length} weeks
          </span>
        }
      >
        {priceSpark.length < 2 ? (
          <p className="text-sm text-ink-400">
            Not enough price observations to plot a meaningful line yet.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <MiniSparkline
              values={priceSpark}
              width={420}
              height={64}
              fill
              color={anchorPalette?.hex}
            />
            <div className="text-right font-mono text-xs text-ink-400">
              <div>Earliest: {fmtUsd(priceSpark[0] ?? 0)}</div>
              <div>Latest: {fmtUsd(priceSpark[priceSpark.length - 1] ?? 0)}</div>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Current listings"
        subtitle={`Live MorphMarket listings carrying every trait in ${combo.display}. Click a listing to open its full page; click a seller to drill into their inventory with this combo pre-filtered.`}
        padded={false}
        right={
          <div className="flex items-center gap-2">
            <Link
              href={`/compare?combos=${combo.id},${HIGH_VALUE_COMBOS.find((c) => c.id !== combo.id)?.id ?? ""}`}
              className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
            >
              Compare →
            </Link>
            <CsvDownloadButton
              rows={filteredLive.map((r) => ({
                listing_id: r.id,
                title: r.title,
                price: r.price_usd_equivalent ?? r.price,
                seller_id: r.seller_id,
                seller_name: r.seller_name,
                seller_location: r.seller_location,
                maturity: r.maturity,
                sex: r.sex,
                first_seen_at: r.first_seen_at,
              }))}
              filename={`${combo.id}-live-${new Date().toISOString().slice(0, 10)}`}
              label="CSV"
            />
          </div>
        }
      >
        <DataTable
          columns={liveCols}
          rows={filteredLive.slice(0, 50)}
          rowKey={(r) => r.id}
          emptyMessage="No live listings in this combo for the current filters."
        />
      </Panel>

      <Panel
        title="Recent sold history"
        subtitle="Last 180 days. Days-to-sell is the gap between first-listed and sold."
        padded={false}
      >
        <DataTable
          columns={soldCols}
          rows={soldRows.slice(0, 50)}
          rowKey={(r) => r.id}
          emptyMessage="No sold comparables in the last 180 days."
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Top sellers in this combo"
          subtitle="By live listing count. Click through to see only this combo on the seller's page."
          padded={false}
        >
          <ul className="divide-y divide-ink-700/40">
            {topSellers.length === 0 ? (
              <li className="p-4 text-sm text-ink-400">No sellers match the current filters.</li>
            ) : (
              topSellers.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <Link
                    href={serverHref(`/sellers/${s.id}`, searchParams, { combos: [combo.id] })}
                    className="text-ink-100 hover:text-claude-glow"
                  >
                    {s.name}
                  </Link>
                  <span className="text-xs text-ink-400">{s.loc ?? ""}</span>
                  <span className="font-mono tabular-nums text-ink-300">{fmtInt(s.n)}</span>
                </li>
              ))
            )}
          </ul>
        </Panel>

        <Panel
          title="Regional spread"
          subtitle="Live count + median ask per region (inferred from seller location). Click a region to load its full page."
          padded={false}
        >
          <ul className="divide-y divide-ink-700/40">
            {REGION_CODES.map((code) => {
              const arr = byRegion.get(code) ?? [];
              const med = median(arr) ?? null;
              return (
                <li key={code} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <Link
                    href={serverHref(`/region/${code}`, searchParams, { combos: [combo.id] })}
                    className="text-ink-100 hover:text-claude-glow"
                  >
                    {code}
                  </Link>
                  <span className="font-mono tabular-nums text-ink-300">{fmtInt(arr.length)}</span>
                  <span className="font-mono tabular-nums text-ink-400">{med ? fmtUsd(med) : "—"}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <SourceFootnote
        sources={["market_listings", "sold_listings_v", "price_history"]}
        n={filteredLive.length + soldRows.length}
        methodologyAnchor="combo-index"
      />
    </div>
  );
}
