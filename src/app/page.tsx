// Public dashboard — top-level analytics overview. Reads directly from
// Supabase using the anon key + the public-read RLS policies. Renders a
// Claude-Code-style welcome header, a "recent sessions" strip of per-source
// ingest cards, KPI tiles, and three D3 chart panels.
import Link from "next/link";
import type { Listing } from "@/components/charts/PriceHistogram";
import type { TraitInput } from "@/components/charts/TraitFrequencyAndPrice";
import type { Seller } from "@/components/charts/SellerLeaderboardScatter";
import ChartGrid from "@/components/charts/ChartGrid";
import KpiCard from "@/components/ui/KpiCard";
import { SectionHeader, StatusPill } from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtRelative, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

type SessionRow = {
  label: string;
  sub: string;
  href: string;
  status: "ready" | "busy" | "info" | "idle";
  tag: string;
  latest?: string | null;
};

async function latest(
  supabase: ReturnType<typeof createClient>,
  table: string,
  col: string,
  extra?: (q: any) => any,
): Promise<string | null> {
  let q = supabase.from(table).select(col).order(col, { ascending: false }).limit(1);
  if (extra) q = extra(q);
  const { data } = await q;
  const row = (data ?? [])[0] as unknown as Record<string, string> | undefined;
  return row?.[col] ?? null;
}

export default async function DashboardPage() {
  const supabase = createClient();

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [
    listingsRes,
    sellersRes,
    dropCount,
    soldCount,
    showCount,
    crossCount,
    priceTickCount,
    newListingCount,
    latestDrop,
    latestSold,
    latestNew,
    latestPriceTick,
    latestCross,
    latestShow,
  ] = await Promise.all([
    supabase
      .from("market_listings")
      .select(
        "id, price, price_usd_equivalent, maturity, sex, cached_traits, norm_traits, first_seen_at",
      )
      .limit(10000),
    supabase
      .from("market_sellers")
      .select(
        "seller_id, seller_name, seller_location, membership, feedback_count, seller_rating_score, total_listings, avg_price, five_star_rating",
      )
      .limit(5000),
    supabase.from("price_drops").select("id", { count: "exact", head: true }).gte("observed_at", sevenDaysAgo),
    supabase
      .from("listing_status_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "sold")
      .gte("observed_at", sevenDaysAgo),
    supabase.from("show_mentions").select("id", { count: "exact", head: true }).gte("observed_at", sevenDaysAgo),
    supabase.from("cross_platform_listings").select("id", { count: "exact", head: true }).gte("last_seen_at", sevenDaysAgo),
    supabase.from("price_history").select("id", { count: "exact", head: true }).gte("observed_at", sevenDaysAgo),
    supabase.from("market_listings").select("id", { count: "exact", head: true }).gte("first_seen_at", sevenDaysAgo),
    latest(supabase, "price_drops", "observed_at"),
    latest(supabase, "listing_status_events", "observed_at", (q) => q.eq("status", "sold")),
    latest(supabase, "market_listings", "first_seen_at"),
    latest(supabase, "price_history", "observed_at"),
    latest(supabase, "cross_platform_listings", "last_seen_at"),
    latest(supabase, "show_mentions", "observed_at"),
  ]);

  if (listingsRes.error || sellersRes.error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
        <p className="font-semibold">Could not load data from Supabase.</p>
        <pre className="mt-2 whitespace-pre-wrap text-xs">
          {listingsRes.error?.message || sellersRes.error?.message}
        </pre>
        <p className="mt-2">
          Check that <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set, and that the SQL
          migrations in <code>supabase/migrations/</code> have been applied.
        </p>
      </div>
    );
  }

  const rowsL = (listingsRes.data ?? []) as Listing[] & TraitInput[];
  const rowsS = (sellersRes.data ?? []) as Seller[];

  const newestIngestIso = [
    latestNew,
    latestDrop,
    latestSold,
    latestPriceTick,
    latestCross,
    latestShow,
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .sort()
    .pop() ?? null;

  const ingestAgeMin = newestIngestIso
    ? Math.max(0, (Date.now() - new Date(newestIngestIso).getTime()) / 60000)
    : null;

  const ingestPill: { status: "ready" | "busy" | "idle" | "info"; label: string } =
    ingestAgeMin === null
      ? { status: "idle", label: "No ingest yet" }
      : ingestAgeMin < 15
        ? { status: "ready", label: `Live · ${fmtRelative(newestIngestIso)}` }
        : ingestAgeMin < 60 * 24
          ? { status: "busy", label: `Lagging · ${fmtRelative(newestIngestIso)}` }
          : { status: "idle", label: `Stale · ${fmtRelative(newestIngestIso)}` };

  // Market-wide summary stats for the hero strip.
  const prices = rowsL
    .map((r) => r.price_usd_equivalent ?? r.price)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

  const sessions: SessionRow[] = [
    {
      label: "New listings",
      sub: `${fmtInt(newListingCount.count ?? 0)} in last 7d`,
      href: "/daily-log",
      status: "ready",
      tag: "listings",
      latest: latestNew,
    },
    {
      label: "Price drops",
      sub: `${fmtInt(dropCount.count ?? 0)} adjustments in last 7d`,
      href: "/price-drops",
      status: "busy",
      tag: "pricing",
      latest: latestDrop,
    },
    {
      label: "Sold",
      sub: `${fmtInt(soldCount.count ?? 0)} closed in last 7d`,
      href: "/sold",
      status: "ready",
      tag: "sales",
      latest: latestSold,
    },
    {
      label: "Price ticks",
      sub: `${fmtInt(priceTickCount.count ?? 0)} observations in last 7d`,
      href: "/trends",
      status: "info",
      tag: "signal",
      latest: latestPriceTick,
    },
    {
      label: "Cross-platform",
      sub: `${fmtInt(crossCount.count ?? 0)} off-MorphMarket updates`,
      href: "/cross-platform",
      status: "info",
      tag: "reach",
      latest: latestCross,
    },
    {
      label: "Show mentions",
      sub: `${fmtInt(showCount.count ?? 0)} expo references`,
      href: "/shows",
      status: "idle",
      tag: "ops",
      latest: latestShow,
    },
  ];

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="claude-star text-2xl leading-none">✷</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
              Welcome back
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">
            The crested gecko market, in one place.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-400">
            {fmtInt(rowsL.length)} listings · {fmtInt(rowsS.length)} sellers ·
            median {median ? fmtUsd(median) : "—"} · mean {avg ? fmtUsd(avg) : "—"}.
            Refreshed live from Supabase on every request.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/status" title="Ingest status detail">
            <StatusPill status={ingestPill.status} label={ingestPill.label} />
          </Link>
          <Link
            href="/daily-log"
            className="rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-200 hover:border-ink-600 hover:text-ink-50"
          >
            View daily log →
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
            Sessions · last 7 days
          </h2>
          <span className="text-xs text-ink-500">Tap a row to drill in</span>
        </div>
        <div className="divide-y divide-ink-700/60 overflow-hidden rounded-lg border border-ink-700 bg-ink-800 shadow-panel">
          {sessions.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-4 px-4 py-3 transition hover:bg-ink-850"
            >
              <span className={`status-dot ${s.status}`} />
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                {s.tag}
              </span>
              <span className="truncate">
                <span className="font-medium text-ink-100">{s.label}</span>
                <span className="ml-2 text-ink-400">{s.sub}</span>
              </span>
              <span className="font-mono text-[11px] text-ink-500">
                {fmtRelative(s.latest)}
              </span>
              <span className="text-ink-500">›</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Snapshot"
          title="Past 7 days"
          description="Event volume across ingest streams."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="New listings" value={fmtInt(newListingCount.count ?? 0)} tone="default" />
          <KpiCard label="Sold" value={fmtInt(soldCount.count ?? 0)} tone="positive" />
          <KpiCard label="Price drops" value={fmtInt(dropCount.count ?? 0)} tone="warn" />
          <KpiCard label="Cross-platform" value={fmtInt(crossCount.count ?? 0)} tone="info" />
        </div>
      </section>

      <ChartGrid
        page="home"
        ctx={{ listings: rowsL, sellers: rowsS }}
      />
    </div>
  );
}
