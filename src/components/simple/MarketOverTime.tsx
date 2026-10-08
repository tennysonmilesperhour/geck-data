"use client";

// The markets page is one cached document. Choosing a morph only changes
// this chart, so the series is fetched from /api/market-weekly and kept at
// the edge instead of re-rendering the whole comparison.
import { useEffect, useLayoutEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import MultiLineChart, { type LineSeries } from "@/components/simple/MultiLineChart";
import { Card, Chip, Section } from "@/components/simple/ui";
import { marketPriceSeries, type MarketWeekLike } from "@/lib/simple/markets";

export type MarketChip = { slug: string; trait: string };

export function MarketChart({
  series,
  title,
  chips,
  active,
}: {
  series: LineSeries[];
  title: string;
  chips: MarketChip[];
  active: string | null;
}) {
  return (
    <Section
      title={`${title}: prices over time`}
      note="Middle asking price each week, in US dollars at today's exchange rate, so the lines show local prices moving rather than currencies."
    >
      <div className="space-y-4">
        <nav aria-label="Morph" className="flex flex-wrap gap-2">
          <Chip href="/markets#over-time" active={!active}>
            All crested
          </Chip>
          {chips.map((c) => (
            <Chip key={c.slug} href={`/markets?t=${c.slug}#over-time`} active={active === c.slug}>
              {c.trait}
            </Chip>
          ))}
        </nav>
        <Card>
          {series.length ? (
            <MultiLineChart series={series} maxGapDays={7} />
          ) : (
            <p className="text-ink-300">Not enough weekly history for this morph yet.</p>
          )}
          <p className="mt-3 text-sm text-ink-400">
            The US line goes back to May 2026. Korea and Europe start with the first run of the new
            market scrapers and add a point each week.
          </p>
        </Card>
      </div>
    </Section>
  );
}

export function MarketOverTime({
  overall,
  chips,
}: {
  overall: LineSeries[];
  chips: MarketChip[];
}) {
  const sp = useSearchParams();
  const slug = sp.get("t") ?? "";
  const active = /^[a-z0-9-]+$/.test(slug) ? slug : "";
  const [loaded, setLoaded] = useState<{ slug: string; trait: string | null; series: LineSeries[] } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const pending = Boolean(active) && loaded?.slug !== active && failed !== active;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (active && (pending || failed === active)) root.setAttribute("data-market-trait", "1");
    else root.removeAttribute("data-market-trait");
  }, [active, pending, failed]);

  useEffect(() => {
    if (!pending) return;
    const ac = new AbortController();
    fetch(`/api/market-weekly/${active}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { trait: string | null; weeks: MarketWeekLike[] };
      })
      .then((data) => {
        setLoaded({
          slug: active,
          trait: data.trait,
          series: marketPriceSeries(data.weeks ?? []),
        });
        setFailed(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(active);
      });
    return () => ac.abort();
  }, [pending, active]);

  if (!active) {
    return <MarketChart series={overall} title="All crested geckos" chips={chips} active={null} />;
  }
  if (pending || failed === active || !loaded || loaded.slug !== active) {
    return (
      <Section title="Prices over time" note="Loading this morph.">
        <p className="text-ink-300">
          {failed === active ? "This chart could not load. Try again in a minute." : "Loading this morph's prices…"}
        </p>
      </Section>
    );
  }

  const shown = loaded.trait && !chips.some((c) => c.slug === active)
    ? [{ slug: active, trait: loaded.trait }, ...chips]
    : chips;
  return (
    <MarketChart
      series={loaded.series}
      title={loaded.trait ?? "All crested geckos"}
      chips={shown}
      active={loaded.trait ? active : null}
    />
  );
}
