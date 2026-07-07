// Site-wide stale-data warning. Rendered from the root layout on every
// public page. When the newest market_listings row is older than 48
// hours it means neither the scrapers nor the extension have delivered
// anything in two days, and every number on the site is describing a
// market that has since moved. Saying so plainly beats letting a
// visitor price a gecko off month-old medians (which is exactly what
// happened during the June 2026 pipeline outage, when the site served
// four-week-old data with no visible warning).
//
// Server component; reads via the anon key (market_listings has a
// public-read RLS policy). Fails closed to "no banner" on any query
// error so a Supabase hiccup can never take down every page.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STALE_AFTER_HOURS = 48;

export default async function StaleDataBanner() {
  let newest: string | null = null;
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from("market_listings")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    newest = (data as { last_seen_at: string | null } | null)?.last_seen_at ?? null;
  } catch {
    return null;
  }

  if (!newest) return null;
  const ageMs = Date.now() - Date.parse(newest);
  if (!Number.isFinite(ageMs) || ageMs < STALE_AFTER_HOURS * 3_600_000) {
    return null;
  }

  const days = Math.floor(ageMs / 86_400_000);
  const ageLabel = days >= 2 ? `${days} days` : `${Math.floor(ageMs / 3_600_000)} hours`;

  return (
    <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
      Data feed interrupted: no new market data for {ageLabel}. Prices and
      trends below reflect the market as of{" "}
      {new Date(newest).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}
      , not today.{" "}
      <Link href="/status" className="underline decoration-dotted hover:opacity-80">
        Pipeline status
      </Link>
    </div>
  );
}
