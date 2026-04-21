// Show & expo mentions — which shows are being referenced, with mention
// count and recency. Helps spot which events drive the most chatter.
import DataTable, { type Column } from "@/components/ui/DataTable";
import KpiCard from "@/components/ui/KpiCard";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtInt, fmtRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

type MentionRow = {
  id: string;
  show_name: string;
  show_date: string | null;
  context: string | null;
  source_url: string | null;
  listing_id: string | null;
  seller_id: string | null;
  observed_at: string;
};

type Aggregated = {
  show_name: string;
  mentions: number;
  last_seen: string;
  distinct_sellers: number;
  distinct_listings: number;
  next_date: string | null;
};

export default async function ShowsPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("show_mentions")
    .select("id, show_name, show_date, context, source_url, listing_id, seller_id, observed_at")
    .order("observed_at", { ascending: false })
    .limit(2000);

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-800">
        Failed to load show mentions: {error.message}
      </div>
    );
  }

  const rows = (data ?? []) as MentionRow[];

  const byShow = new Map<string, Aggregated>();
  for (const r of rows) {
    const existing = byShow.get(r.show_name);
    if (!existing) {
      byShow.set(r.show_name, {
        show_name: r.show_name,
        mentions: 1,
        last_seen: r.observed_at,
        distinct_sellers: r.seller_id ? 1 : 0,
        distinct_listings: r.listing_id ? 1 : 0,
        next_date: r.show_date,
      });
    } else {
      existing.mentions += 1;
      if (Date.parse(r.observed_at) > Date.parse(existing.last_seen)) {
        existing.last_seen = r.observed_at;
      }
      if (r.show_date) {
        if (!existing.next_date || Date.parse(r.show_date) > Date.parse(existing.next_date)) {
          existing.next_date = r.show_date;
        }
      }
    }
  }
  // Distinct counts require a second pass
  const sellerSets = new Map<string, Set<string>>();
  const listingSets = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.seller_id) {
      (sellerSets.get(r.show_name) ?? sellerSets.set(r.show_name, new Set()).get(r.show_name)!).add(
        r.seller_id,
      );
    }
    if (r.listing_id) {
      (listingSets.get(r.show_name) ?? listingSets.set(r.show_name, new Set()).get(r.show_name)!).add(
        r.listing_id,
      );
    }
  }
  for (const [name, agg] of byShow.entries()) {
    agg.distinct_sellers = sellerSets.get(name)?.size ?? 0;
    agg.distinct_listings = listingSets.get(name)?.size ?? 0;
  }

  const shows = Array.from(byShow.values()).sort((a, b) => b.mentions - a.mentions);

  const columns: Column<Aggregated>[] = [
    { key: "name", header: "Show", render: (s) => <span className="font-medium">{s.show_name}</span> },
    { key: "mentions", header: "Mentions", align: "right", render: (s) => fmtInt(s.mentions) },
    { key: "sellers", header: "Sellers", align: "right", render: (s) => fmtInt(s.distinct_sellers) },
    {
      key: "listings",
      header: "Listings",
      align: "right",
      render: (s) => fmtInt(s.distinct_listings),
    },
    { key: "next", header: "Latest date", render: (s) => fmtDate(s.next_date) },
    { key: "last_seen", header: "Last mention", render: (s) => fmtRelative(s.last_seen) },
  ];

  const recentColumns: Column<MentionRow>[] = [
    { key: "show", header: "Show", render: (r) => r.show_name },
    {
      key: "context",
      header: "Context",
      render: (r) => (
        <span className="line-clamp-2 text-neutral-700">{r.context ?? "—"}</span>
      ),
    },
    {
      key: "link",
      header: "Source",
      render: (r) =>
        r.source_url ? (
          <a
            href={r.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-gecko hover:underline"
          >
            open ↗
          </a>
        ) : (
          "—"
        ),
    },
    { key: "when", header: "Seen", render: (r) => fmtRelative(r.observed_at) },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-gecko-dark">Shows & expos</h1>
        <p className="mt-1 text-neutral-600">
          Show names mentioned in listings, bios, or forum posts, aggregated by
          event.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Distinct shows" value={shows.length} />
        <KpiCard label="Total mentions" value={rows.length} />
        <KpiCard
          label="Top show"
          value={shows[0]?.show_name ?? "—"}
          sub={shows[0] ? `${shows[0].mentions} mentions` : undefined}
        />
        <KpiCard
          label="Most recent"
          value={shows.length > 0 ? fmtRelative(shows[0].last_seen) : "—"}
        />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Shows by mention count</h2>
        <DataTable
          columns={columns}
          rows={shows}
          rowKey={(s) => s.show_name}
          emptyMessage="No show mentions captured yet."
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent mentions</h2>
        <DataTable
          columns={recentColumns}
          rows={rows.slice(0, 50)}
          rowKey={(r) => r.id}
          emptyMessage="No mentions yet."
        />
      </section>
    </div>
  );
}
