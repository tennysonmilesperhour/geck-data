"use client";
// Landing hero — the first thing a paying client sees. Four live KPIs
// (median, count, sellers, hottest combo) plus a one-line market summary.
// Numbers animate in on first paint via CountUp so the page feels alive,
// then sit still — no scrolling tickers, no churn.
//
// Marked "use client" because CountUp accepts a `format` function prop;
// passing functions across the server→client boundary isn't allowed.
import Link from "next/link";
import CountUp from "./CountUp";
import { fmtUsd, fmtInt } from "@/lib/format";
import type { MarketSnapshot } from "@/lib/landing/snapshot";

type Props = {
  snapshot: MarketSnapshot;
};

export default function HeroBand({ snapshot }: Props) {
  const { totals, hottest_combo } = snapshot;

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
            <span className="status-dot" />
            Live · Crested Gecko Market
          </div>
          <h1 className="font-display text-balance text-[44px] font-medium leading-[1.05] tracking-[-0.015em] text-ink-50 md:text-[56px]">
            What&apos;s happening{" "}
            <span className="text-claude-glow">right now.</span>
          </h1>
          <p className="mt-4 text-base leading-7 text-ink-300">
            Pricing, trait economics, regional spread, and seller signal —
            refreshed from MorphMarket every day. New to crested geckos? Start
            with{" "}
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
          label="Median listing"
          value={
            totals.median_price ? (
              <CountUp
                to={totals.median_price}
                format={(n) => fmtUsd(n)}
              />
            ) : (
              "—"
            )
          }
          sub={
            totals.p25_price && totals.p75_price
              ? `${fmtUsd(totals.p25_price)} – ${fmtUsd(totals.p75_price)} mid range`
              : ""
          }
        />
        <KpiTile
          label="Live listings"
          value={
            <CountUp to={totals.live_listings} format={(n) => fmtInt(n)} />
          }
          sub={`${fmtInt(totals.sold_listings)} sold all-time`}
        />
        <KpiTile
          label="Active sellers"
          value={<CountUp to={totals.sellers} format={(n) => fmtInt(n)} />}
          sub="Across MorphMarket"
        />
        <KpiTile
          label="Hottest combo"
          value={hottest_combo?.combo_name ?? "—"}
          sub={
            hottest_combo
              ? `${hottest_combo.live_count} live · median ${hottest_combo.median_ask ? fmtUsd(hottest_combo.median_ask) : "—"}`
              : "No combos in window"
          }
          accent
        />
      </div>
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
          ? "border-emerald-500/40 shadow-[0_0_0_1px_rgba(14,154,115,0.06)]"
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
