// Cross-platform listings captured from Fauna Classifieds, Reptile Forums,
// Preloved, Kijiji, etc. Grouped by platform with a recent-activity table.
import DataTable, { type Column } from "@/components/ui/DataTable";
import KpiCard from "@/components/ui/KpiCard";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtRelative, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

type CrossRow = {
  id: string;
  platform: string;
  external_id: string;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  currency: string | null;
  seller_name: string | null;
  seller_location: string | null;
  url: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

type PlatformAgg = {
  platform: string;
  count: number;
  newest: string;
  median_price: number | null;
};

const PLATFORM_LABELS: Record<string, string> = {
  fauna_classifieds: "Fauna Classifieds",
  reptile_forums: "Reptile Forums",
  preloved: "Preloved",
  kijiji: "Kijiji",
};

export default async function CrossPlatformPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("cross_platform_listings")
    .select(
      "id, platform, external_id, title, price, price_usd_equivalent, currency, seller_name, seller_location, url, first_seen_at, last_seen_at",
    )
    .order("last_seen_at", { ascending: false })
    .limit(1000);

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-800">
        Failed to load cross-platform listings: {error.message}
      </div>
    );
  }

  const rows = (data ?? []) as CrossRow[];

  const byPlatform = new Map<string, CrossRow[]>();
  for (const r of rows) {
    const arr = byPlatform.get(r.platform) ?? [];
    arr.push(r);
    byPlatform.set(r.platform, arr);
  }
  const platforms: PlatformAgg[] = Array.from(byPlatform.entries())
    .map(([platform, list]) => ({
      platform,
      count: list.length,
      newest: list.reduce(
        (acc, r) =>
          Date.parse(r.last_seen_at) > Date.parse(acc) ? r.last_seen_at : acc,
        list[0].last_seen_at,
      ),
      median_price: median(list.map((r) => r.price_usd_equivalent ?? r.price)),
    }))
    .sort((a, b) => b.count - a.count);

  const columns: Column<CrossRow>[] = [
    {
      key: "platform",
      header: "Platform",
      render: (r) => (
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
          {PLATFORM_LABELS[r.platform] ?? r.platform}
        </span>
      ),
    },
    {
      key: "title",
      header: "Listing",
      render: (r) => (
        <div>
          <div className="font-medium">
            {r.url ? (
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-gecko hover:underline"
              >
                {r.title ?? "(untitled)"} ↗
              </a>
            ) : (
              (r.title ?? "(untitled)")
            )}
          </div>
          <div className="text-xs text-neutral-500">{r.seller_name ?? "—"}</div>
        </div>
      ),
    },
    {
      key: "location",
      header: "Location",
      render: (r) => r.seller_location ?? "—",
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (r) => (
        <span>
          {fmtUsd(r.price_usd_equivalent ?? r.price)}
          {r.currency && r.currency !== "USD" && (r.price_usd_equivalent ?? null) == null ? (
            <span className="ml-1 text-xs text-neutral-500">{r.currency}</span>
          ) : null}
        </span>
      ),
    },
    { key: "first", header: "First seen", render: (r) => fmtRelative(r.first_seen_at) },
    { key: "last", header: "Last seen", render: (r) => fmtRelative(r.last_seen_at) },
  ];

  const platformColumns: Column<PlatformAgg>[] = [
    {
      key: "p",
      header: "Platform",
      render: (p) => (
        <span className="font-medium">{PLATFORM_LABELS[p.platform] ?? p.platform}</span>
      ),
    },
    { key: "c", header: "Listings", align: "right", render: (p) => fmtInt(p.count) },
    {
      key: "m",
      header: "Median price",
      align: "right",
      render: (p) => fmtUsd(p.median_price),
    },
    { key: "n", header: "Latest activity", render: (p) => fmtRelative(p.newest) },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-gecko-dark">Cross-platform</h1>
        <p className="mt-1 text-neutral-600">
          Listings observed on platforms other than MorphMarket.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total listings" value={rows.length} />
        <KpiCard label="Platforms" value={platforms.length} />
        <KpiCard
          label="Top platform"
          value={platforms[0] ? PLATFORM_LABELS[platforms[0].platform] ?? platforms[0].platform : "—"}
          sub={platforms[0] ? `${platforms[0].count} listings` : undefined}
        />
        <KpiCard
          label="Latest"
          value={rows.length > 0 ? fmtRelative(rows[0].last_seen_at) : "—"}
        />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">By platform</h2>
        <DataTable
          columns={platformColumns}
          rows={platforms}
          rowKey={(p) => p.platform}
          emptyMessage="Nothing captured from other platforms yet."
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent listings</h2>
        <DataTable
          columns={columns}
          rows={rows.slice(0, 200)}
          rowKey={(r) => r.id}
          emptyMessage="Nothing captured yet."
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
