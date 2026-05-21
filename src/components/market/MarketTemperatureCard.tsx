"use client";
// Composite "is the crested market hot?" widget. Fetches /api/market/temperature
// once on mount and renders the latest score, the week-over-week delta, and a
// 52-week sparkline.
//
// Designed to sit at the very top of /market as the headline number — one
// scalar a viewer can read without parsing 30 charts.
//
// Clicking the card jumps to /trends?timeframe=12mo so a viewer who wants to
// understand WHY the number is at its current level can drill into the
// underlying supply/demand/velocity series.
import { useEffect, useState } from "react";
import Link from "next/link";
import MiniSparkline from "@/components/charts/MiniSparkline";

type WeekPoint = {
  week_start: string;
  temperature: number;
  listed_n: number;
  sold_n: number;
  sell_through: number | null;
  median_sold_usd: number | null;
};

type Payload = {
  score: number | null;
  delta_vs_last_week: number | null;
  series: WeekPoint[];
};

function classifyScore(score: number | null): { label: string; tone: string } {
  if (score == null) return { label: "—", tone: "text-forest-400" };
  if (score >= 70) return { label: "Hot", tone: "text-warn" };
  if (score >= 50) return { label: "Warm", tone: "text-ready" };
  if (score >= 30) return { label: "Cool", tone: "text-forest-200" };
  return { label: "Cold", tone: "text-forest-400" };
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
  const cls = classifyScore(score);
  const series = data?.series ?? [];
  const sparkValues = series.map((p) => p.temperature);

  return (
    <Link
      href="/trends?timeframe=12mo"
      className="forest-surface group flex items-center justify-between gap-4 p-4 transition hover:border-ready/40"
    >
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-forest-400">
          Market temperature
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={`font-display text-[34px] font-medium tracking-tight ${cls.tone}`}>
            {score ?? "—"}
          </span>
          <span className={`text-xs uppercase tracking-wider ${cls.tone}`}>{cls.label}</span>
          {data?.delta_vs_last_week != null && (
            <span
              className={
                "ml-2 font-mono text-[11px] " +
                (data.delta_vs_last_week > 0
                  ? "text-warn"
                  : data.delta_vs_last_week < 0
                    ? "text-forest-400"
                    : "text-forest-500")
              }
            >
              {data.delta_vs_last_week > 0 ? "▲" : data.delta_vs_last_week < 0 ? "▼" : "·"}{" "}
              {Math.abs(data.delta_vs_last_week)}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-forest-500">
          Composite of sell-through, velocity, volume, price (52w baseline).
        </div>
        {error && (
          <div className="mt-1 text-[11px] text-forest-500">
            unavailable: {error}
          </div>
        )}
      </div>
      {sparkValues.length > 0 && (
        <div className="shrink-0">
          <MiniSparkline values={sparkValues} width={160} height={36} />
        </div>
      )}
    </Link>
  );
}
