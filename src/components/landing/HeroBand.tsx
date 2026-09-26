"use client";
// Landing hero, the first thing a paying client sees. Four KPIs plus the
// sentence that says what those KPIs are measured over.
//
// The tiles report the FRESH population only: live rows the ingest re-confirmed
// inside snapshot's freshness window. The much larger block of rows we have not
// re-confirmed since spring gets its own count and its own median underneath,
// never blended into the headline. A median taken across both describes a
// market that no longer exists.
//
// Marked "use client" because CountUp accepts a `format` function prop, and
// functions cannot cross the server to client boundary.
import Link from "next/link";
import CountUp from "./CountUp";
import { fmtUsd, fmtInt, fmtDate, fmtRelative } from "@/lib/format";
import type { MarketSnapshot } from "@/lib/landing/snapshot";

type Props = {
  snapshot: MarketSnapshot;
};

export default function HeroBand({ snapshot }: Props) {
  const { totals, hottest_combo } = snapshot;

  // The dot is the one piece of chrome that reads as a health claim, so it
  // tracks the data instead of being decorative: green only while the newest
  // observation is still inside the freshness window.
  const newestSeenMs = totals.newest_seen_at
    ? Date.parse(totals.newest_seen_at)
    : NaN;
  const feedIsFresh =
    Number.isFinite(newestSeenMs) &&
    Date.now() - newestSeenMs < totals.fresh_hours * 3_600_000;

  const midRange =
    totals.fresh_p25_ask != null && totals.fresh_p75_ask != null
      ? `${fmtUsd(totals.fresh_p25_ask)} to ${fmtUsd(totals.fresh_p75_ask)} middle half`
      : null;
  const medianSample =
    totals.fresh_priced_listings != null
      ? `${fmtInt(totals.fresh_priced_listings)} fresh asks`
      : "fresh asks only";
  const medianSub = midRange
    ? `${midRange}, ${medianSample}`
    : `No priced fresh ads in the last ${totals.fresh_hours} hours`;

  const staleRange =
    totals.oldest_stale_seen_at && totals.newest_stale_seen_at
      ? `${fmtDate(totals.oldest_stale_seen_at)} to ${fmtDate(totals.newest_stale_seen_at)}`
      : totals.oldest_stale_seen_at
        ? `from ${fmtDate(totals.oldest_stale_seen_at)}`
        : null;
  const staleSub =
    totals.stale_listings > 0
      ? staleRange
        ? `${fmtInt(totals.stale_listings)} more last confirmed ${staleRange}`
        : `${fmtInt(totals.stale_listings)} more not re-confirmed since`
      : `Every live ad re-confirmed in the last ${totals.fresh_hours} hours`;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-ink-700/80 bg-gradient-to-br from-ink-850 via-ink-900 to-ink-900 p-7 shadow-panel">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ink-600/70 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-32 h-72 w-72 rounded-full bg-emerald-500/[0.04] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -bottom-24 h-64 w-64 rounded-full bg-sky-400/[0.04] blur-3xl"
      />

      <div className="relative flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-400">
            <span className={feedIsFresh ? "status-dot" : "status-dot idle"} />
            {totals.newest_seen_at
              ? `Crested gecko market · last confirmed ${fmtRelative(totals.newest_seen_at)}`
              : "Crested gecko market · no observations on record"}
          </div>
          <h1 className="font-display text-balance text-[44px] font-medium leading-[1.05] tracking-[-0.015em] text-ink-50 md:text-[56px]">
            What&apos;s actually{" "}
            <span className="text-claude-glow">for sale.</span>
          </h1>
          <p className="mt-4 text-base leading-7 text-ink-300">
            Pricing, trait economics, regional spread, and seller signal, rebuilt
            from a weekly MorphMarket ingest. The tiles below count only ads we
            re-confirmed in the last {totals.fresh_hours} hours. New to crested
            geckos? Start with{" "}
            <Link href="#whats-hot" className="text-claude-glow hover:underline">
              what&apos;s selling
            </Link>
            . Looking to time the market? Try{" "}
            <Link href="/trends" className="text-claude-glow hover:underline">
              trends
            </Link>
            .
          </p>
        </div>
        <Link
          href="/market"
          className="inline-flex w-fit items-center gap-2 rounded-md border border-ink-700 bg-ink-850/80 px-4 py-2 text-sm font-medium text-ink-100 shadow-panel transition hover:border-emerald-500/40 hover:bg-ink-800 hover:text-emerald-100"
        >
          Open the market dashboard
          <span aria-hidden>→</span>
        </Link>
      </div>

      <div className="relative mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Median fresh ask"
          value={
            totals.fresh_median_ask != null ? (
              <CountUp
                to={totals.fresh_median_ask}
                format={(n) => fmtUsd(n)}
              />
            ) : (
              "Unavailable"
            )
          }
          sub={medianSub}
        />
        <KpiTile
          label="Fresh live ads"
          value={<CountUp to={totals.fresh_listings} format={(n) => fmtInt(n)} />}
          sub={staleSub}
        />
        <KpiTile
          label="Sellers on fresh ads"
          value={
            totals.fresh_sellers != null ? (
              <CountUp to={totals.fresh_sellers} format={(n) => fmtInt(n)} />
            ) : (
              "Unavailable"
            )
          }
          sub={
            totals.live_sellers != null
              ? `${fmtInt(totals.live_sellers)} across every live ad, stale included`
              : "Seller count not available for this window"
          }
        />
        <KpiTile
          label="Deepest combo"
          value={hottest_combo?.combo_name ?? "No combos in window"}
          sub={
            hottest_combo
              ? hottest_combo.fresh_live_count > 0
                ? `${fmtInt(hottest_combo.fresh_live_count)} fresh live · ${
                    hottest_combo.fresh_median_ask != null
                      ? `${fmtUsd(hottest_combo.fresh_median_ask)} median`
                      : "no fresh median"
                  }`
                : `${fmtInt(hottest_combo.live_count)} in the 365 day catalogue · ${
                    hottest_combo.median_ask != null
                      ? `${fmtUsd(hottest_combo.median_ask)} catalogue median`
                      : "no median ask"
                  }`
              : "No combos in window"
          }
          accent
        />
      </div>

      <p className="relative mt-4 max-w-3xl text-xs leading-5 text-ink-400">
        {totals.stale_listings > 0 && staleRange
          ? `The other ${fmtInt(totals.stale_listings)} ads still flagged live were last confirmed ${staleRange}, and nothing has re-confirmed them since, so they are kept out of the median and the count above. On their own they sit at a ${
              totals.stale_median_ask != null
                ? fmtUsd(totals.stale_median_ask)
                : "n/a"
            } median ask. `
          : ""}
        {totals.group_lots_excluded > 0
          ? `${fmtInt(totals.group_lots_excluded)} multi-animal lots are held out of every price above, since a lot prices a group rather than an animal. `
          : ""}
        Combo tiles use ads re-confirmed in the last {totals.fresh_hours} hours
        when any exist. The 365 day catalogue count is labelled as catalogue,
        not as live.
      </p>
    </section>
  );
}

function KpiTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-ink-850/60 px-4 py-3.5 backdrop-blur transition hover:bg-ink-800 ${
        accent
          ? "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.06)]"
          : "border-ink-700"
      }`}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
        {label}
      </div>
      <div
        className={`mt-1.5 truncate text-2xl font-semibold tabular-nums tracking-tight ${
          accent ? "text-emerald-200" : "text-ink-50"
        }`}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-1 truncate text-xs text-ink-400">{sub}</div>
      ) : null}
    </div>
  );
}
