// /watchlist — entity-oriented view of every saved watch the user
// owns. Persists into the existing alerts table (each alert IS a
// watch); /alerts shows the *matches* inbox, this page shows the
// *subscriptions* themselves grouped by entity.
//
// Unauthenticated visitors see an in-page login prompt with a sensible
// next= param so they return here after sign-in. RLS keeps the query
// safe either way.
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fmtRelative } from "@/lib/format";
import { SectionHeader, Panel } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import { HIGH_VALUE_COMBOS, comboFromName } from "@/lib/market/combos";
import { slugifyTrait } from "@/lib/filters/schema";

export const dynamic = "force-dynamic";

type AlertRow = {
  id: string;
  name: string | null;
  query: Record<string, unknown> | null;
  active: boolean;
  created_at: string;
};

export default async function WatchlistPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="page-rise space-y-6">
        <SectionHeader
          eyebrow="Personal"
          title="Your watchlist"
          description="Save combos, traits, sellers, regions, or free-typed morph terms here. Matches land in /alerts."
        />
        <Panel tone="soft" title="Sign in to save and view your watchlist">
          <p className="text-sm text-ink-300">
            Watchlists are private and tied to your account. Click below to
            sign in or create one, and we will bring you straight back here.
          </p>
          <Link
            href="/login?next=/watchlist"
            className="mt-3 inline-flex rounded-md bg-claude px-3 py-1.5 text-sm text-ink-50 hover:bg-claude-glow"
          >
            Sign in
          </Link>
        </Panel>
      </div>
    );
  }

  const { data, error } = await supabase
    .from("alerts")
    .select("id, name, query, active, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
        Failed to load watchlist: {error.message}
      </div>
    );
  }

  const rows = (data ?? []) as AlertRow[];

  // Group by entity kind.
  type Group = { kind: string; rows: AlertRow[] };
  const byKind = new Map<string, Group>();
  for (const r of rows) {
    const kind = ((r.query?.kind as string | undefined) ?? "other").toLowerCase();
    const g = byKind.get(kind) ?? { kind, rows: [] };
    g.rows.push(r);
    byKind.set(kind, g);
  }
  const groups = Array.from(byKind.values());

  function entityHref(r: AlertRow): string | null {
    const q = r.query ?? {};
    const kind = q.kind as string | undefined;
    if (kind === "combo") {
      const name = (q.combo as string) ?? null;
      if (!name) return null;
      const canonical = comboFromName(name);
      return canonical ? `/combo/${canonical.id}` : null;
    }
    if (kind === "morph") {
      const term = (q.term as string) ?? null;
      if (!term) return null;
      return `/trait/${slugifyTrait(term)}`;
    }
    if (kind === "seller") {
      const id = (q.seller_id as string) ?? null;
      return id ? `/sellers/${id}` : null;
    }
    if (kind === "region") {
      const code = (q.region as string) ?? null;
      return code ? `/region/${code}` : null;
    }
    return null;
  }

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Personal"
        title="Your watchlist"
        description={`${rows.length} saved ${rows.length === 1 ? "watch" : "watches"}. Each watch tracks an entity and feeds the /alerts inbox when matches arrive.`}
        right={
          <Link href="/alerts" className="text-xs text-ink-400 underline hover:text-ink-100">
            Recent matches →
          </Link>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total watches" value={rows.length} />
        <KpiCard label="Active" value={rows.filter((r) => r.active).length} tone="positive" />
        <KpiCard label="Combos" value={(byKind.get("combo")?.rows ?? []).length} />
        <KpiCard label="Sellers" value={(byKind.get("seller")?.rows ?? []).length} />
      </section>

      {groups.length === 0 ? (
        <Panel tone="soft" title="Nothing watched yet">
          <p className="text-sm text-ink-300">
            Click the ☆ Watch button on any combo page, trait page, seller
            page, or sold row to start tracking it here. Suggestions:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-400">
            <li>
              <Link href={`/combo/${HIGH_VALUE_COMBOS[0]!.id}`} className="underline hover:text-ink-100">
                {HIGH_VALUE_COMBOS[0]!.display}
              </Link>
              {" "}— our top-volume canonical combo.
            </li>
            <li>
              <Link href={`/trait/lilly-white`} className="underline hover:text-ink-100">
                Lilly White
              </Link>{" "}
              — the most-watched anchor trait.
            </li>
          </ul>
        </Panel>
      ) : (
        groups.map((g) => (
          <Panel
            key={g.kind}
            title={
              g.kind === "combo"
                ? "Combos"
                : g.kind === "morph"
                  ? "Traits / morph terms"
                  : g.kind === "seller"
                    ? "Sellers"
                    : g.kind === "region"
                      ? "Regions"
                      : "Other"
            }
            subtitle={`${g.rows.length} saved ${g.rows.length === 1 ? "watch" : "watches"}`}
            padded={false}
          >
            <ul className="divide-y divide-ink-700/40">
              {g.rows.map((r) => {
                const href = entityHref(r);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <div className="min-w-0">
                      {href ? (
                        <Link href={href} className="text-ink-100 hover:text-claude-glow">
                          {r.name ?? "Unnamed watch"}
                        </Link>
                      ) : (
                        <span className="text-ink-200">{r.name ?? "Unnamed watch"}</span>
                      )}
                      <div className="font-mono text-[10px] text-ink-500">{r.id.slice(0, 8)}</div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono uppercase tracking-wider ${
                          r.active
                            ? "border-ready/40 bg-ready/10 text-ready"
                            : "border-ink-700 bg-ink-850 text-ink-500"
                        }`}
                      >
                        {r.active ? "active" : "paused"}
                      </span>
                      <span className="text-ink-400">{fmtRelative(r.created_at)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}
