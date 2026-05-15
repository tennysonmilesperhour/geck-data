// Market Trends — longitudinal view of the crested gecko market. Shows
// daily/weekly cadence across every event stream plus price movement,
// trait momentum, and cohort metrics. All reads go through the anon key
// and the public-read policies; the page reshapes raw rows into the
// Series format consumed by TimeSeriesLine.
import { Panel, SectionHeader, StatusPill } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import TimeSeriesLine, {
  type Series,
  type SeriesPoint,
} from "@/components/charts/TimeSeriesLine";
import { chartTheme } from "@/components/charts/theme";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtPct, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

function dayBucketISO(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function weekBucketISO(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Anchor to Monday of the week.
  const day = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() - (day - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

type CountRow = { t: string };
function series(
  rows: CountRow[],
  bucket: (iso: string) => string | null,
): SeriesPoint[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = bucket(r.t);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([k, v]) => ({ t: new Date(k + "T00:00:00Z"), v }))
    .sort((a, b) => a.t.getTime() - b.t.getTime());
}

function medianSeries(
  rows: Array<{ t: string; v: number }>,
  bucket: (iso: string) => string | null,
): SeriesPoint[] {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const k = bucket(r.t);
    if (!k) continue;
    const arr = map.get(k) ?? [];
    arr.push(r.v);
    map.set(k, arr);
  }
  const out: SeriesPoint[] = [];
  for (const [k, arr] of map) {
    arr.sort((a, b) => a - b);
    const m = arr[Math.floor(arr.length / 2)];
    out.push({ t: new Date(k + "T00:00:00Z"), v: m });
  }
  return out.sort((a, b) => a.t.getTime() - b.t.getTime());
}

export default async function TrendsPage() {
  const supabase = createClient();

  const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const since90 = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const since14 = new Date(Date.now() - 14 * DAY_MS).toISOString();
  const prev14 = new Date(Date.now() - 28 * DAY_MS).toISOString();

  const [
    newListingsRaw,
    priceDropsRaw,
    soldEventsRaw,
    priceHistoryRaw,
    listingsAll,
    recentCount14,
    priorCount14,
  ] = await Promise.all([
    supabase
      .from("market_listings")
      .select("first_seen_at")
      .gte("first_seen_at", since90)
      .limit(20000),
    supabase
      .from("price_drops")
      .select("observed_at, pct_change")
      .gte("observed_at", since90)
      .limit(20000),
    supabase
      .from("listing_status_events")
      .select("observed_at")
      .eq("status", "sold")
      .gte("observed_at", since90)
      .limit(20000),
    supabase
      .from("price_history")
      .select("observed_at, price")
      .gte("observed_at", since90)
      .limit(20000),
    supabase
      .from("market_listings")
      .select("id, price, price_usd_equivalent, maturity, norm_traits, cached_traits, first_seen_at")
      .limit(20000),
    supabase
      .from("market_listings")
      .select("id", { count: "exact", head: true })
      .gte("first_seen_at", since14),
    supabase
      .from("market_listings")
      .select("id", { count: "exact", head: true })
      .gte("first_seen_at", prev14)
      .lt("first_seen_at", since14),
  ]);

  const newListingsDaily = series(
    (newListingsRaw.data ?? []).map((r) => ({ t: r.first_seen_at as string })),
    dayBucketISO,
  );
  const priceDropsDaily = series(
    (priceDropsRaw.data ?? []).map((r) => ({ t: r.observed_at as string })),
    dayBucketISO,
  );
  const soldDaily = series(
    (soldEventsRaw.data ?? []).map((r) => ({ t: r.observed_at as string })),
    dayBucketISO,
  );
  const priceTicksDaily = series(
    (priceHistoryRaw.data ?? []).map((r) => ({ t: r.observed_at as string })),
    dayBucketISO,
  );

  // Weekly median price from price_history (if populated)
  const priceRows = (priceHistoryRaw.data ?? [])
    .map((r) => ({ t: r.observed_at as string, v: Number(r.price) }))
    .filter((r) => Number.isFinite(r.v) && r.v > 0 && r.v < 10_000);
  const medianPriceWeekly = medianSeries(priceRows, weekBucketISO);

  // Current snapshot: median by maturity
  type Row = {
    price: number | null;
    price_usd_equivalent: number | null;
    maturity: string | null;
    norm_traits: string | null;
    cached_traits: string | null;
    first_seen_at: string | null;
  };
  const all = (listingsAll.data ?? []) as Row[];
  const byMaturity = new Map<string, number[]>();
  for (const r of all) {
    const p = r.price_usd_equivalent ?? r.price;
    if (!p || p <= 0 || p > 10_000) continue;
    const m = r.maturity ?? "unknown";
    const arr = byMaturity.get(m) ?? [];
    arr.push(p);
    byMaturity.set(m, arr);
  }
  const medianByMaturity: Array<{ maturity: string; median: number; count: number }> = [];
  for (const [m, arr] of byMaturity) {
    arr.sort((a, b) => a - b);
    medianByMaturity.push({
      maturity: m,
      median: arr[Math.floor(arr.length / 2)],
      count: arr.length,
    });
  }
  medianByMaturity.sort((a, b) => b.count - a.count);

  // Trait momentum: count each trait in new listings last 14d vs prior 14d.
  const prev14End = Date.now() - 14 * DAY_MS;
  const prev14Start = Date.now() - 28 * DAY_MS;
  const recent = (since14Iso: string, before?: string) =>
    all.filter((r) => {
      if (!r.first_seen_at) return false;
      const t = Date.parse(r.first_seen_at);
      if (!Number.isFinite(t)) return false;
      const afterStart = t >= Date.parse(since14Iso);
      const beforeEnd = before ? t < Date.parse(before) : true;
      return afterStart && beforeEnd;
    });
  const recentListings = recent(since14);
  const priorListings = all.filter((r) => {
    if (!r.first_seen_at) return false;
    const t = Date.parse(r.first_seen_at);
    return t >= prev14Start && t < prev14End;
  });

  const traitCounts = (rows: Row[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const raw = (r.norm_traits || r.cached_traits || "").toLowerCase();
      if (!raw) continue;
      const tokens = raw.includes(",")
        ? raw.split(",").map((t) => t.trim())
        : raw.split(/\s+/).map((t) => t.trim());
      const seen = new Set<string>();
      for (const t of tokens) {
        if (!t || t.length < 3 || seen.has(t)) continue;
        seen.add(t);
        m.set(t, (m.get(t) ?? 0) + 1);
      }
    }
    return m;
  };
  const recentTraits = traitCounts(recentListings);
  const priorTraits = traitCounts(priorListings);
  const allTraitKeys = new Set<string>([...recentTraits.keys(), ...priorTraits.keys()]);
  const momentum: Array<{
    trait: string;
    recent: number;
    prior: number;
    delta: number; // percentage
  }> = [];
  for (const t of allTraitKeys) {
    const r = recentTraits.get(t) ?? 0;
    const p = priorTraits.get(t) ?? 0;
    if (r + p < 4) continue; // noise floor
    const delta = p === 0 ? (r > 0 ? 100 : 0) : ((r - p) / p) * 100;
    momentum.push({ trait: t, recent: r, prior: p, delta });
  }
  const topRising = [...momentum]
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10);
  const topFalling = [...momentum]
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 10);

  const volumeSeries: Series[] = [
    { name: "New listings", color: chartTheme.series[0], points: newListingsDaily },
    { name: "Price drops", color: chartTheme.series[3], points: priceDropsDaily },
    { name: "Sold", color: chartTheme.series[2], points: soldDaily },
    { name: "Price ticks", color: chartTheme.series[1], points: priceTicksDaily },
  ];

  const medianPriceSeries: Series[] = [
    {
      name: "Median price (weekly)",
      color: chartTheme.primary,
      points: medianPriceWeekly,
    },
  ];

  const maturitySeries: Series[] = medianByMaturity.map((m, i) => ({
    name: m.maturity,
    color: chartTheme.series[i % chartTheme.series.length],
    // Plot a flat "current" point as a degenerate series — useful when price_history
    // is sparse but the current snapshot is always available.
    points: [{ t: new Date(), v: m.median }],
  }));

  const recentAvgDrop =
    (priceDropsRaw.data ?? [])
      .map((r) => Number(r.pct_change))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b, _, arr) => a + b / arr.length, 0) || 0;
  const countDelta =
    (priorCount14.count ?? 0) === 0
      ? (recentCount14.count ?? 0) > 0
        ? 100
        : 0
      : (((recentCount14.count ?? 0) - (priorCount14.count ?? 0)) /
          (priorCount14.count ?? 1)) *
        100;

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Analysis / Trends"
        title="Market Trends"
        description="Longitudinal signal across the crested gecko market. Compare the last 14 days to the 14 days before to see where volume, price, and trait interest are moving."
        right={<StatusPill status="info" label="90-day window" />}
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="New listings · 14d"
          value={fmtInt(recentCount14.count ?? 0)}
          delta={{ value: countDelta, label: "vs prev 14d" }}
        />
        <KpiCard
          label="Avg drop size"
          value={fmtPct(recentAvgDrop, 1)}
          tone={recentAvgDrop < 0 ? "warn" : "default"}
          sub="arithmetic mean of pct_change"
        />
        <KpiCard
          label="Median listing"
          value={fmtUsd(
            medianByMaturity.reduce((a, m) => a + m.median, 0) /
              Math.max(1, medianByMaturity.length),
          )}
          sub="averaged across maturities"
          tone="info"
        />
        <KpiCard
          label="Tracked listings"
          value={fmtInt(all.length)}
          tone="default"
          sub={`${medianByMaturity.length} maturity cohorts`}
        />
      </section>

      <Panel
        title="Event volume"
        subtitle="Daily count across ingest streams. Big gaps = ingest paused; bursts = scrape batches."
        right={<span className="font-mono text-[11px]">last 90d</span>}
      >
        <TimeSeriesLine series={volumeSeries} height={280} />
      </Panel>

      <Panel
        title="Weekly median price"
        subtitle="Median of observed prices per week from the price_history stream."
        right={<span className="font-mono text-[11px]">USD</span>}
      >
        {medianPriceWeekly.length < 2 ? (
          <p className="text-sm text-ink-400">
            Not enough price observations yet — the scraper hasn&apos;t accumulated
            enough history to plot a meaningful median line. Current snapshot is
            below.
          </p>
        ) : (
          <TimeSeriesLine
            series={medianPriceSeries}
            height={280}
            yFormat={(n) => `$${n.toLocaleString()}`}
          />
        )}
      </Panel>

      <Panel
        title="Median price by maturity (current)"
        subtitle="Cross-section of the live market. Juvenile pricing tends to be the broadest market; adult pricing reflects proven breeders."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {medianByMaturity.map((m, i) => (
            <div
              key={m.maturity}
              className="rounded-md border border-ink-700 bg-ink-850 p-3"
            >
              <div
                className="font-mono text-[10px] uppercase tracking-wider"
                style={{ color: chartTheme.series[i % chartTheme.series.length] }}
              >
                {m.maturity}
              </div>
              <div className="mt-1 text-xl font-semibold text-ink-50">
                {fmtUsd(m.median)}
              </div>
              <div className="mt-0.5 text-xs text-ink-400">
                {fmtInt(m.count)} listings
              </div>
            </div>
          ))}
        </div>
        {maturitySeries.length > 0 ? (
          <div className="mt-4 hidden">{/* reserved for future per-maturity trend */}</div>
        ) : null}
      </Panel>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Panel
          title="Rising traits · 14d"
          subtitle="Percent change in trait appearance among new listings."
        >
          <ul className="divide-y divide-ink-700/60 font-mono text-[13px]">
            {topRising.map((m) => (
              <li
                key={m.trait}
                className="flex items-center justify-between py-1.5"
              >
                <span className="text-ink-100">{m.trait}</span>
                <span className="flex items-center gap-3">
                  <span className="text-ink-400">
                    {m.prior} → {m.recent}
                  </span>
                  <span className="w-16 text-right text-ready">
                    {fmtPct(m.delta, 0)}
                  </span>
                </span>
              </li>
            ))}
            {topRising.length === 0 ? (
              <li className="py-3 text-ink-500">Not enough new listings yet.</li>
            ) : null}
          </ul>
        </Panel>

        <Panel
          title="Cooling traits · 14d"
          subtitle="Percent change down — interest fading relative to prior window."
        >
          <ul className="divide-y divide-ink-700/60 font-mono text-[13px]">
            {topFalling.map((m) => (
              <li
                key={m.trait}
                className="flex items-center justify-between py-1.5"
              >
                <span className="text-ink-100">{m.trait}</span>
                <span className="flex items-center gap-3">
                  <span className="text-ink-400">
                    {m.prior} → {m.recent}
                  </span>
                  <span className="w-16 text-right text-danger">
                    {fmtPct(m.delta, 0)}
                  </span>
                </span>
              </li>
            ))}
            {topFalling.length === 0 ? (
              <li className="py-3 text-ink-500">Not enough new listings yet.</li>
            ) : null}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
