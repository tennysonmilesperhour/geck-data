// Public ingest status page. Shows, per ingest stream, how many rows exist
// (lifetime + last 7 days) and how long ago the newest event landed. Reads
// via the anon key — the same public-read RLS policies the home page uses —
// so no Bearer token is needed. Use this to answer "is the extension
// actually writing to Supabase right now?" from the browser.
import Link from "next/link";
import { Panel, SectionHeader, StatusPill } from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

type Stream = {
  table: string;
  timeCol: string;
  label: string;
  note: string;
};

const STREAMS: Stream[] = [
  {
    table: "market_listings",
    timeCol: "last_seen_at",
    label: "Listings seen",
    note: "every listingSeen event bumps this — the single best signal that the extension is scanning right now",
  },
  {
    table: "market_listings",
    timeCol: "first_seen_at",
    label: "New listings discovered",
    note: "a listing_id we hadn't seen before",
  },
  {
    table: "price_drops",
    timeCol: "observed_at",
    label: "Price drops",
    note: "explicit old→new price deltas",
  },
  {
    table: "listing_status_events",
    timeCol: "observed_at",
    label: "Status events",
    note: "sold / live / hold / removed / returned transitions",
  },
  {
    table: "price_history",
    timeCol: "observed_at",
    label: "Price observations",
    note: "every price tick, whether changed or not",
  },
  {
    table: "auction_results",
    timeCol: "closed_at",
    label: "Auction closes",
    note: "final price + bid count at auction end",
  },
  {
    table: "seller_snapshots",
    timeCol: "observed_at",
    label: "Seller snapshots",
    note: "periodic per-seller feedback / inventory metrics",
  },
  {
    table: "show_mentions",
    timeCol: "observed_at",
    label: "Show mentions",
    note: "expo / show references parsed from listing text",
  },
  {
    table: "cross_platform_listings",
    timeCol: "last_seen_at",
    label: "Cross-platform listings",
    note: "Fauna Classifieds, Reptile Forums, Preloved, Kijiji, …",
  },
];

type StreamResult = {
  stream: Stream;
  total: number | null;
  last7d: number | null;
  newest: string | null;
  error: string | null;
};

function classify(
  newestIso: string | null,
): { status: "ready" | "busy" | "idle" | "info"; label: string; tone: string } {
  if (!newestIso) return { status: "idle", label: "No activity", tone: "No events yet" };
  const ageMin = Math.max(0, (Date.now() - new Date(newestIso).getTime()) / 60000);
  if (ageMin < 15) return { status: "ready", label: "Live", tone: "Fresh (<15 min)" };
  if (ageMin < 60 * 24) return { status: "busy", label: "Lagging", tone: "Quiet for a while" };
  return { status: "idle", label: "Stale", tone: "No events in 24 h+" };
}

export default async function StatusPage() {
  const supabase = createClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  const results: StreamResult[] = await Promise.all(
    STREAMS.map(async (stream): Promise<StreamResult> => {
      const [totalRes, weekRes, newestRes] = await Promise.all([
        supabase.from(stream.table).select("*", { count: "exact", head: true }),
        supabase
          .from(stream.table)
          .select("*", { count: "exact", head: true })
          .gte(stream.timeCol, sevenDaysAgo),
        supabase
          .from(stream.table)
          .select(stream.timeCol)
          .order(stream.timeCol, { ascending: false, nullsFirst: false })
          .limit(1),
      ]);

      const err =
        totalRes.error?.message ??
        weekRes.error?.message ??
        newestRes.error?.message ??
        null;
      const row = (newestRes.data ?? [])[0] as unknown as
        | Record<string, string | null>
        | undefined;
      return {
        stream,
        total: totalRes.count ?? null,
        last7d: weekRes.count ?? null,
        newest: row?.[stream.timeCol] ?? null,
        error: err,
      };
    }),
  );

  const newestOverall =
    results
      .map((r) => r.newest)
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .sort()
      .pop() ?? null;

  const overall = classify(newestOverall);

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="claude-star text-2xl leading-none">✷</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
              Ingest status
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">
            Is the extension writing to Supabase?
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-400">
            One row per ingest stream. Counts and timestamps read live from
            Supabase on every request. If every stream says{" "}
            <span className="font-mono text-ink-300">Stale</span> or{" "}
            <span className="font-mono text-ink-300">No activity</span>, the
            plugin isn&rsquo;t reaching <code>/api/ingest</code> — or events
            are being rejected. Admins: drill into{" "}
            <Link
              href="/admin/analytics"
              className="underline decoration-dotted hover:text-ink-100"
            >
              Analytics → Ingest audit
            </Link>{" "}
            for per-request detail.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusPill
            status={overall.status}
            label={`${overall.label} · ${fmtRelative(newestOverall)}`}
          />
          <span className="text-[11px] text-ink-500">{overall.tone}</span>
        </div>
      </section>

      <Panel padded={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700/70 text-left">
              <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Stream
              </th>
              <th className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Last 7 d
              </th>
              <th className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Lifetime
              </th>
              <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Newest
              </th>
              <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/60">
            {results.map((r) => {
              const cls = classify(r.newest);
              return (
                <tr key={`${r.stream.table}-${r.stream.timeCol}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink-100">{r.stream.label}</div>
                    <div className="text-xs text-ink-500">
                      <span className="font-mono">{r.stream.table}</span>
                      <span className="text-ink-600"> · </span>
                      <span className="font-mono">{r.stream.timeCol}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-400">{r.stream.note}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-ink-200">
                    {r.last7d == null ? "—" : fmtInt(r.last7d)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-ink-300">
                    {r.total == null ? "—" : fmtInt(r.total)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-ink-300">
                    {r.error ? (
                      <span className="text-danger">error: {r.error}</span>
                    ) : (
                      fmtRelative(r.newest)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={cls.status} label={cls.label} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <SectionHeader
        eyebrow="How to use this page"
        title="Reading the signal"
        description="What to look for, and what to do when it's off."
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Panel title="Live (green)">
          <p className="text-sm text-ink-300">
            Newest event in this stream landed less than 15 minutes ago. The
            plugin is actively scanning and writes are reaching Supabase.
          </p>
        </Panel>
        <Panel title="Lagging (amber)">
          <p className="text-sm text-ink-300">
            Newest event is 15 min – 24 h old. Could be normal (the extension
            isn&rsquo;t open) or could be a quiet period on MorphMarket. Not
            a problem on its own; worth watching.
          </p>
        </Panel>
        <Panel title="Stale / No activity (grey)">
          <p className="text-sm text-ink-300">
            Nothing in 24 h or the table is empty. Re-check:{" "}
            <code>INGEST_API_KEY</code> env var, the extension&rsquo;s target
            host, and <code>/admin/analytics</code> → Ingest audit for 4xx /
            5xx responses.
          </p>
        </Panel>
      </div>
    </div>
  );
}
