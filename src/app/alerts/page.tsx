// Alerts inbox. Shows each alert the current user owns and the most recent
// matches. Unauthenticated visitors get an in-page login prompt; the query
// itself is safe either way — owner-scoped RLS on the alerts table means an
// anon caller sees zero rows.
import Link from "next/link";
import DataTable, { type Column } from "@/components/ui/DataTable";
import KpiCard from "@/components/ui/KpiCard";
import { SectionHeader } from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { fmtRelative, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

type AlertRow = {
  id: string;
  name: string;
  query: Record<string, unknown>;
  active: boolean;
  created_at: string;
};

type MatchRow = {
  id: string;
  alert_id: string;
  listing_id: string | null;
  cross_platform_listing_id: string | null;
  matched_at: string;
  payload: Record<string, unknown> | null;
  alerts: { name: string } | null;
  market_listings: {
    title: string | null;
    price_usd_equivalent: number | null;
    price: number | null;
    seller_id: string | null;
  } | null;
  cross_platform_listings: {
    platform: string | null;
    title: string | null;
    price_usd_equivalent: number | null;
    url: string | null;
  } | null;
};

export default async function AlertsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="rounded-md border border-busy/40 bg-busy/10 p-4 text-sm text-busy">
        You need to{" "}
        <Link href="/login?next=/alerts" className="font-semibold underline">
          log in
        </Link>{" "}
        to see your alerts.
      </div>
    );
  }

  const { data: alerts, error: aErr } = await supabase
    .from("alerts")
    .select("id, name, query, active, created_at")
    .order("created_at", { ascending: false });
  if (aErr) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
        Failed to load alerts: {aErr.message}
      </div>
    );
  }
  const alertRows = (alerts ?? []) as AlertRow[];
  const alertIds = alertRows.map((a) => a.id);

  let matches: MatchRow[] = [];
  if (alertIds.length > 0) {
    const { data, error } = await supabase
      .from("alert_matches")
      .select(
        "id, alert_id, listing_id, cross_platform_listing_id, matched_at, payload, alerts!inner(name), market_listings(title, price_usd_equivalent, price, seller_id), cross_platform_listings(platform, title, price_usd_equivalent, url)",
      )
      .in("alert_id", alertIds)
      .order("matched_at", { ascending: false })
      .limit(200);
    if (error) {
      return (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          Failed to load matches: {error.message}
        </div>
      );
    }
    matches = (data ?? []) as unknown as MatchRow[];
  }

  const activeCount = alertRows.filter((a) => a.active).length;
  const sevenDay = matches.filter(
    (m) => Date.now() - Date.parse(m.matched_at) < 7 * 86400_000,
  );

  const matchColumns: Column<MatchRow>[] = [
    {
      key: "alert",
      header: "Alert",
      render: (m) => m.alerts?.name ?? m.alert_id,
    },
    {
      key: "what",
      header: "Matched",
      render: (m) => {
        if (m.market_listings) {
          return (
            <div>
              <div className="font-medium text-ink-100">
                {m.market_listings.title ?? m.listing_id}
              </div>
              <div className="text-xs text-ink-400">
                MorphMarket · {m.listing_id}
              </div>
            </div>
          );
        }
        if (m.cross_platform_listings) {
          return (
            <div>
              <div className="font-medium text-ink-100">
                {m.cross_platform_listings.url ? (
                  <a
                    href={m.cross_platform_listings.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-claude hover:underline"
                  >
                    {m.cross_platform_listings.title ?? "(untitled)"} ↗
                  </a>
                ) : (
                  (m.cross_platform_listings.title ?? "(untitled)")
                )}
              </div>
              <div className="text-xs text-ink-400">
                {m.cross_platform_listings.platform}
              </div>
            </div>
          );
        }
        return "—";
      },
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (m) =>
        fmtUsd(
          m.market_listings?.price_usd_equivalent ??
            m.market_listings?.price ??
            m.cross_platform_listings?.price_usd_equivalent,
        ),
    },
    { key: "when", header: "Matched", render: (m) => fmtRelative(m.matched_at) },
  ];

  const alertColumns: Column<AlertRow>[] = [
    { key: "name", header: "Name", render: (a) => <span className="font-medium">{a.name}</span> },
    {
      key: "active",
      header: "Active",
      render: (a) => (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            a.active
              ? "border-ready/40 bg-ready/10 text-ready"
              : "border-ink-700 bg-ink-850 text-ink-400"
          }`}
        >
          {a.active ? "on" : "off"}
        </span>
      ),
    },
    {
      key: "query",
      header: "Query",
      render: (a) => (
        <code className="text-xs text-ink-400">
          {truncate(JSON.stringify(a.query), 80)}
        </code>
      ),
    },
    { key: "created", header: "Created", render: (a) => fmtRelative(a.created_at) },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Inbox"
        title="Alerts"
        description="Saved queries and the matches the extension has sent back."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Alerts" value={alertRows.length} />
        <KpiCard label="Active" value={activeCount} tone="positive" />
        <KpiCard label="Total matches" value={matches.length} />
        <KpiCard label="Matches past 7d" value={sevenDay.length} tone="warn" />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink-50">Your alerts</h2>
        <DataTable
          columns={alertColumns}
          rows={alertRows}
          rowKey={(a) => a.id}
          emptyMessage="No alerts yet. The alert creation UI is coming soon."
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink-50">Recent matches</h2>
        <DataTable
          columns={matchColumns}
          rows={matches}
          rowKey={(m) => m.id}
          emptyMessage="No matches yet."
        />
      </section>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
