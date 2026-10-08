// Watchlist: the alerts you saved and the listings that matched them, on
// one page. Alerts are created from the price check, morph pages and
// breeder pages with the "Alert me" button. Owner-scoped row-level
// security means a visitor only ever sees their own rows.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtUsd } from "@/lib/format";
import { ButtonLink, Card, Empty, PageIntro, Section, fmtShortDate } from "@/components/simple/ui";
import AlertControls from "@/components/simple/AlertControls";

export const dynamic = "force-dynamic";

export const metadata = { title: "Watchlist - Geck Inspect Market" };

type AlertRow = {
  id: string;
  name: string | null;
  query: Record<string, unknown> | null;
  active: boolean;
  created_at: string;
};

type MatchRow = {
  id: string;
  alert_id: string;
  listing_id: string | null;
  matched_at: string;
  market_listings: { title: string | null; price_usd_equivalent: number | null; price: number | null } | null;
};

/** Say what an alert watches in plain words, from its saved query. */
function describe(q: Record<string, unknown> | null): string {
  if (!q) return "Any crested gecko";
  const parts: string[] = [];
  const traits = (q.trait_all as string[] | undefined) ?? [];
  const any = (q.trait_any as string[] | undefined) ?? [];
  const sellers = (q.seller_ids as string[] | undefined) ?? [];
  if (traits.length) parts.push(traits.join(" + "));
  else if (any.length) parts.push(`any of ${any.join(", ")}`);
  else if (typeof q.term === "string") parts.push(q.term);
  else if (typeof q.combo === "string") parts.push(q.combo);
  else parts.push("Any crested gecko");
  if (sellers.length || typeof q.seller_id === "string") {
    parts.push(`from ${sellers.join(", ") || (q.seller_id as string)}`);
  }
  if (typeof q.max_price === "number") parts.push(`listed at ${fmtUsd(q.max_price)} or less`);
  if (typeof q.min_price === "number") parts.push(`at ${fmtUsd(q.min_price)} or more`);
  return parts.join(", ");
}

export default async function WatchlistPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <PageIntro title="Watchlist">
          Save a morph, a price or a breeder and see new listings that match. Log in to
          start one.
        </PageIntro>
        <Card className="space-y-4">
          <p className="text-ink-300">
            Use the &quot;Alert me&quot; button on any price check, morph page or breeder
            page. Your alerts stay private to your account.
          </p>
          <ButtonLink href="/login?next=/watchlist">Log in</ButtonLink>
        </Card>
      </div>
    );
  }

  const { data: alertData } = await supabase
    .from("alerts")
    .select("id, name, query, active, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const alerts = (alertData ?? []) as AlertRow[];

  let matches: MatchRow[] = [];
  if (alerts.length) {
    const { data } = await supabase
      .from("alert_matches")
      .select("id, alert_id, listing_id, matched_at, market_listings(title, price_usd_equivalent, price)")
      .in(
        "alert_id",
        alerts.map((a) => a.id),
      )
      .order("matched_at", { ascending: false })
      .limit(100);
    matches = (data ?? []) as unknown as MatchRow[];
  }
  const nameOf = new Map(alerts.map((a) => [a.id, a.name ?? describe(a.query)]));

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <PageIntro title="Watchlist">
        The alerts you saved and the listings that matched them.
      </PageIntro>

      <Section title="Your alerts" note={`${alerts.length} saved`}>
        {alerts.length ? (
          <ul className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-ink-50">{a.name ?? describe(a.query)}</div>
                  <div className="text-sm text-ink-400">
                    {describe(a.query)} · saved {fmtShortDate(a.created_at)}
                    {a.active ? "" : " · paused"}
                  </div>
                </div>
                <AlertControls id={a.id} active={a.active} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            No alerts yet. Run a{" "}
            <Link href="/" className="text-claude-glow hover:underline">
              price check
            </Link>{" "}
            and tap &quot;Alert me&quot; to save one.
          </Empty>
        )}
      </Section>

      <Section title="Matches" note="New listings that fit one of your alerts.">
        {matches.length ? (
          <ul className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
            {matches.map((m) => {
              const price = m.market_listings?.price_usd_equivalent ?? m.market_listings?.price ?? null;
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-ink-100">
                      {m.listing_id ? (
                        <a
                          href={`https://www.morphmarket.com/us/c/reptiles/lizards/crested-geckos/${m.listing_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-claude-glow"
                        >
                          {m.market_listings?.title ?? `Listing ${m.listing_id}`}
                        </a>
                      ) : (
                        m.market_listings?.title ?? "Listing"
                      )}
                    </div>
                    <div className="text-xs text-ink-500">
                      {nameOf.get(m.alert_id) ?? "Alert"} · {fmtShortDate(m.matched_at)}
                    </div>
                  </div>
                  <div className="shrink-0 tabular-nums text-ink-100">{price != null ? fmtUsd(price) : ""}</div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No matches yet. Matches appear as new listings come in.</Empty>
        )}
      </Section>
    </div>
  );
}
