"use client";
// Composite "is the crested market hot?" widget. Fetches /api/market/temperature
// once on mount and renders the latest score, the week-over-week delta, and the
// trailing run of scored weeks as a sparkline.
//
// Designed to sit at the very top of /market as the headline number: one scalar
// a viewer can read without parsing 30 charts.
//
// The number is allowed to be missing. The API returns score: null plus a
// reason whenever its coverage gates fail, and this card prints that reason
// instead of a tier word. The old behaviour was a neutral 50 labelled "Warm",
// which turned "no sold data since May" into a positive market condition.
//
// Clicking the card jumps to /trends?window=90, which is a window /trends
// actually parses. The old link passed ?timeframe=12mo and /trends only ever
// read ?window=90|180, so the parameter did nothing.
import { useEffect, useState } from "react";
import Link from "next/link";
import MiniSparkline from "@/components/charts/MiniSparkline";

type WeekPoint = {
  week_start: string;
  temperature: number | null;
  listed_n: number;
  sold_n: number;
  sell_through: number | null;
  median_sold_usd: number | null;
};

type Payload = {
  score: number | null;
  // Optional so an edge-cached response from the previous shape still renders.
  status?: "ok" | "unavailable";
  unavailable_reason?: string | null;
  unavailable_detail?: string | null;
  newest_sold_at?: string | null;
  delta_vs_last_week: number | null;
  coverage?: { scored_weeks: number; weeks: number };
  series: WeekPoint[];
};

function classifyScore(score: number): { label: string; tone: string } {
  if (score >= 70) return { label: "Hot", tone: "text-busy" };
  if (score >= 50) return { label: "Warm", tone: "text-ready" };
  if (score >= 30) return { label: "Cool", tone: "text-info" };
  return { label: "Cold", tone: "text-forest-400" };
}

// Only the trailing run of consecutive scored weeks is plotted. The series is
// 52 weeks long and mostly unscored, so a line drawn across it would join May
// to August as though the weeks in between had been measured.
function trailingScored(series: WeekPoint[]): number[] {
  const out: number[] = [];
  for (let i = series.length - 1; i >= 0; i--) {
    const t = series[i].temperature;
    if (t == null) break;
    out.unshift(t);
  }
  return out;
}

export default function MarketTemperatureCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/market/temperature");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as Payload;
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const score = data?.score ?? null;
  const loading = data == null && error == null;
  const sparkValues = score == null ? [] : trailingScored(data?.series ?? []);
  const cls = score == null ? null : classifyScore(score);
  const delta = score == null ? null : (data?.delta_vs_last_week ?? null);
  const scoredWeeks = data?.coverage?.scored_weeks ?? null;

  // Why there is no number. The route writes this sentence because it is the
  // only place that knows which gate failed and when the sold stream stopped.
  const why = error
    ? `Could not load the temperature feed: ${error}.`
    : (data?.unavailable_detail ??
      "Not enough recent sold evidence to score the market.");

  return (
    <Link
      href="/trends?window=90"
      className="forest-surface group flex items-center justify-between gap-4 p-4 transition hover:border-ready/40"
    >
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-forest-400">
          Market temperature
        </div>
        {score != null && cls ? (
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`font-display text-[34px] font-medium tracking-tight ${cls.tone}`}>
              {score}
            </span>
            <span className={`text-xs uppercase tracking-wider ${cls.tone}`}>{cls.label}</span>
            {delta != null && (
              <span
                className={
                  "ml-2 font-mono text-[11px] " +
                  (delta > 0 ? "text-busy" : delta < 0 ? "text-forest-400" : "text-forest-500")
                }
              >
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "·"} {Math.abs(delta)}
              </span>
            )}
          </div>
        ) : (
          <div className="mt-1 font-display text-[22px] font-medium tracking-tight text-forest-300">
            {loading ? "Loading" : "Unavailable"}
          </div>
        )}
        {score != null ? (
          <div className="mt-1 text-[11px] text-forest-500">
            Composite of sell-through, velocity, volume and price
            {scoredWeeks != null ? `, ranked against ${scoredWeeks} observed weeks.` : "."}
          </div>
        ) : (
          !loading && (
            <div className="mt-1 max-w-[30rem] text-[11px] leading-relaxed text-forest-400">
              {why}
            </div>
          )
        )}
      </div>
      {sparkValues.length >= 2 && (
        <div className="shrink-0">
          <MiniSparkline values={sparkValues} width={160} height={36} />
        </div>
      )}
    </Link>
  );
}
