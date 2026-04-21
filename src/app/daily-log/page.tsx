// Daily Log — chronological stream of what data arrived each day across
// every event source the app tracks. Reads counts-per-day from each event
// table and renders a Claude-Code-style per-day card with per-source
// Ready/Idle chips, totals, and relative timestamps.
import { Panel, SectionHeader, StatusPill } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

type Bucket = { day: string; count: number; latest?: string | null };
type Source = {
  key: string;
  label: string;
  description: string;
  status: "ready" | "idle" | "info" | "busy";
  byDay: Record<string, Bucket>;
};

function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function friendlyDay(key: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  if (key === today) return "Today";
  if (key === yday) return "Yesterday";
  return new Date(key + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function fetchBuckets(
  supabase: ReturnType<typeof createClient>,
  table: string,
  timeCol: string,
  extraFilter?: (q: any) => any,
  sinceDays = 30,
): Promise<Bucket[]> {
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  let q = supabase.from(table).select(timeCol).gte(timeCol, since).limit(20000);
  if (extraFilter) q = extraFilter(q);
  const { data, error } = await q;
  if (error || !data) return [];
  const map = new Map<string, Bucket>();
  for (const row of data as Record<string, string>[]) {
    const k = dayKey(row[timeCol]);
    if (!k) continue;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { day: k, count: 1, latest: row[timeCol] });
    } else {
      prev.count += 1;
      if (!prev.latest || row[timeCol] > prev.latest) prev.latest = row[timeCol];
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.day < b.day ? 1 : -1));
}

export default async function DailyLogPage() {
  const supabase = createClient();

  const [
    newListings,
    priceHistory,
    priceDrops,
    soldEvents,
    allStatusEvents,
    auctionResults,
    sellerSnapshots,
    showMentions,
    crossPlatform,
  ] = await Promise.all([
    fetchBuckets(supabase, "market_listings", "first_seen_at"),
    fetchBuckets(supabase, "price_history", "observed_at"),
    fetchBuckets(supabase, "price_drops", "observed_at"),
    fetchBuckets(supabase, "listing_status_events", "observed_at", (q) =>
      q.eq("status", "sold"),
    ),
    fetchBuckets(supabase, "listing_status_events", "observed_at"),
    fetchBuckets(supabase, "auction_results", "closed_at"),
    fetchBuckets(supabase, "seller_snapshots", "observed_at"),
    fetchBuckets(supabase, "show_mentions", "observed_at"),
    fetchBuckets(supabase, "cross_platform_listings", "last_seen_at"),
  ]);

  const toMap = (b: Bucket[]): Record<string, Bucket> =>
    Object.fromEntries(b.map((x) => [x.day, x]));

  const sources: Source[] = [
    {
      key: "new_listings",
      label: "New listings",
      description: "First time a listing was observed",
      status: "ready",
      byDay: toMap(newListings),
    },
    {
      key: "price_history",
      label: "Price observations",
      description: "Any recorded price tick per listing",
      status: "info",
      byDay: toMap(priceHistory),
    },
    {
      key: "price_drops",
      label: "Price drops",
      description: "Listings whose price decreased",
      status: "busy",
      byDay: toMap(priceDrops),
    },
    {
      key: "sold",
      label: "Sold",
      description: "Listings transitioned to sold",
      status: "ready",
      byDay: toMap(soldEvents),
    },
    {
      key: "status_events",
      label: "Status events",
      description: "All state transitions (live / sold / hold / removed)",
      status: "info",
      byDay: toMap(allStatusEvents),
    },
    {
      key: "auctions",
      label: "Auction closes",
      description: "Auctions that completed",
      status: "busy",
      byDay: toMap(auctionResults),
    },
    {
      key: "sellers",
      label: "Seller snapshots",
      description: "Periodic seller metric reads",
      status: "info",
      byDay: toMap(sellerSnapshots),
    },
    {
      key: "shows",
      label: "Show mentions",
      description: "Expo references found in listings / bios",
      status: "idle",
      byDay: toMap(showMentions),
    },
    {
      key: "cross_platform",
      label: "Cross-platform",
      description: "Listings from Fauna / Reptile Forums / Preloved / Kijiji",
      status: "info",
      byDay: toMap(crossPlatform),
    },
  ];

  // Union of all days across every source, newest first.
  const allDays = Array.from(
    new Set(sources.flatMap((s) => Object.keys(s.byDay))),
  ).sort((a, b) => (a < b ? 1 : -1));

  // Top-line KPIs — totals across the last 7 days.
  const sevenDays = new Set(
    Array.from({ length: 7 }).map((_, i) =>
      new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10),
    ),
  );
  const total = (s: Source) =>
    Object.values(s.byDay)
      .filter((b) => sevenDays.has(b.day))
      .reduce((acc, b) => acc + b.count, 0);

  const kpiNew = sources.find((s) => s.key === "new_listings")!;
  const kpiDrops = sources.find((s) => s.key === "price_drops")!;
  const kpiSold = sources.find((s) => s.key === "sold")!;
  const kpiPrice = sources.find((s) => s.key === "price_history")!;

  const maxPerDay = Math.max(
    1,
    ...allDays.map((d) =>
      sources.reduce((acc, s) => acc + (s.byDay[d]?.count ?? 0), 0),
    ),
  );

  const latestOverall = sources
    .flatMap((s) => Object.values(s.byDay).map((b) => b.latest ?? null))
    .filter((x): x is string => !!x)
    .sort()
    .slice(-1)[0];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Ingest / Activity"
        title="Daily Log"
        description="Every data source that feeds the dashboard, grouped by the day it arrived. Use this to spot gaps, gauge freshness, and time analyses against ingest cadence."
        right={
          <div className="flex items-center gap-3">
            <StatusPill status="ready" label="Live" />
            <span className="font-mono text-[11px] text-ink-400">
              Last event {fmtRelative(latestOverall)}
            </span>
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="New listings · 7d" value={fmtInt(total(kpiNew))} tone="default" />
        <KpiCard label="Price ticks · 7d" value={fmtInt(total(kpiPrice))} tone="info" />
        <KpiCard label="Price drops · 7d" value={fmtInt(total(kpiDrops))} tone="warn" />
        <KpiCard label="Sold · 7d" value={fmtInt(total(kpiSold))} tone="positive" />
      </section>

      {allDays.length === 0 ? (
        <Panel title="No events in window">
          <p className="text-sm text-ink-400">
            Nothing was ingested in the last 30 days. Trigger a scrape or upload a
            snapshot on the Upload page.
          </p>
        </Panel>
      ) : (
        <div className="space-y-4">
          {allDays.map((day) => {
            const dayTotal = sources.reduce(
              (acc, s) => acc + (s.byDay[day]?.count ?? 0),
              0,
            );
            const latest = sources
              .map((s) => s.byDay[day]?.latest)
              .filter((x): x is string => !!x)
              .sort()
              .slice(-1)[0];
            const barPct = Math.round((dayTotal / maxPerDay) * 100);

            return (
              <Panel
                key={day}
                tone="card"
                padded={false}
                title={
                  <span className="flex items-center gap-2">
                    <span className="status-dot" />
                    <span>{friendlyDay(day)}</span>
                    <span className="font-mono text-[11px] text-ink-500">{day}</span>
                  </span>
                }
                subtitle={
                  <span className="flex items-center gap-3">
                    <span>{fmtInt(dayTotal)} events across {sources.filter((s) => s.byDay[day]).length} sources</span>
                    <span className="text-ink-500">·</span>
                    <span>Last at {fmtRelative(latest)}</span>
                  </span>
                }
                right={
                  <div className="flex w-40 items-center gap-2">
                    <div className="h-1 flex-1 rounded bg-ink-700">
                      <div
                        className="h-1 rounded bg-claude"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className="font-mono text-[10px] text-ink-500">
                      {barPct}%
                    </span>
                  </div>
                }
              >
                <ul className="divide-y divide-ink-700/60">
                  {sources.map((s) => {
                    const b = s.byDay[day];
                    const active = !!b && b.count > 0;
                    return (
                      <li
                        key={s.key}
                        className={`flex items-center gap-4 px-4 py-2.5 text-sm ${
                          active ? "text-ink-100" : "text-ink-500"
                        }`}
                      >
                        <span
                          className={`status-dot ${active ? s.status : "idle"}`}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-medium ${
                                active ? "text-ink-100" : "text-ink-500"
                              }`}
                            >
                              {s.label}
                            </span>
                            <span className="hidden text-xs text-ink-500 md:inline">
                              {s.description}
                            </span>
                          </div>
                        </div>
                        <div className="w-28 text-right font-mono text-[12px] tabular-nums">
                          {active ? fmtInt(b!.count) : "—"}
                        </div>
                        <div className="w-28 text-right font-mono text-[11px] text-ink-500">
                          {active ? fmtRelative(b!.latest) : "no activity"}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}

      <Panel title="How this page is built" tone="soft">
        <p className="text-sm text-ink-300">
          Each day bucket counts rows across nine event tables:
          <span className="font-mono text-ink-400">
            {" "}market_listings, price_history, price_drops, listing_status_events (all +
            sold), auction_results, seller_snapshots, show_mentions,
            cross_platform_listings
          </span>
          . The bar shows the share of the busiest day in the last 30 days.
          Dot color reflects the source category — green for state transitions,
          amber for price movement, blue for observations, gray for inactive.
        </p>
      </Panel>
    </div>
  );
}
