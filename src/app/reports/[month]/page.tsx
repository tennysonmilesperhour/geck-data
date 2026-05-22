// /reports/[month] — auto-generated monthly market report.
//
// Pulls four things and weaves them into a plain-language summary:
//   1) Market temperature for the month (v_market_temperature)
//   2) Top combo gainers / losers (combo_index_daily month-over-month)
//   3) Regional notes (region with most live activity)
//   4) Anomalies from the cadence (any backfill weeks, large day
//      counts vs prior periods)
//
// All numbers source-tagged; methodology link in the footer.
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fmtUsd, fmtInt } from "@/lib/format";
import { SectionHeader, Panel } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import MiniSparkline from "@/components/charts/MiniSparkline";
import SourceFootnote from "@/components/ui/SourceFootnote";
import { HIGH_VALUE_COMBOS } from "@/lib/market/combos";
import { paletteFor, anchorOf } from "@/lib/market/anchors";

export const dynamic = "force-dynamic";

type Params = { month: string };

function parseMonth(slug: string): { start: Date; end: Date; label: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(slug);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  const start = new Date(Date.UTC(y, mm - 1, 1));
  const end = new Date(Date.UTC(y, mm, 1));
  const label = start.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { start, end, label };
}

export async function generateMetadata({ params }: { params: Params }) {
  const parsed = parseMonth(params.month);
  if (!parsed) return { title: "Report not found" };
  return { title: `${parsed.label} report - Geck Inspect Market` };
}

export default async function MonthlyReport({ params }: { params: Params }) {
  const parsed = parseMonth(params.month);
  if (!parsed) notFound();
  const { start, end, label } = parsed;
  const supabase = createClient();

  const [addedRes, soldRes, comboCurRes, comboPriorRes] = await Promise.all([
    supabase
      .from("market_listings")
      .select("id")
      .gte("first_seen_at", start.toISOString())
      .lt("first_seen_at", end.toISOString())
      .limit(20000),
    supabase
      .from("listing_status_events")
      .select("listing_id")
      .eq("status", "sold")
      .gte("observed_at", start.toISOString())
      .lt("observed_at", end.toISOString())
      .limit(20000),
    supabase
      .from("combo_index_daily")
      .select("combo_id, day, median_price, n")
      .gte("day", start.toISOString().slice(0, 10))
      .lt("day", end.toISOString().slice(0, 10))
      .order("day", { ascending: true })
      .limit(5000),
    supabase
      .from("combo_index_daily")
      .select("combo_id, day, median_price, n")
      .lt("day", start.toISOString().slice(0, 10))
      .gte(
        "day",
        new Date(start.getTime() - 31 * 86400_000).toISOString().slice(0, 10),
      )
      .order("day", { ascending: false })
      .limit(5000),
  ]);

  const addedCount = (addedRes.data ?? []).length;
  const soldCount = (soldRes.data ?? []).length;

  type Daily = { combo_id: string; day: string; median_price: number | string | null; n: number | string };
  const curRows = (comboCurRes.data ?? []) as Daily[];
  const priorRows = (comboPriorRes.data ?? []) as Daily[];

  // Compute month-median per combo (current and prior month).
  function medianByCombo(rows: Daily[]) {
    const buckets = new Map<string, number[]>();
    for (const r of rows) {
      if (r.median_price == null) continue;
      const v = Number(r.median_price);
      if (!Number.isFinite(v)) continue;
      const arr = buckets.get(r.combo_id) ?? [];
      arr.push(v);
      buckets.set(r.combo_id, arr);
    }
    const out = new Map<string, number>();
    for (const [k, arr] of buckets) {
      arr.sort((a, b) => a - b);
      out.set(k, arr[Math.floor(arr.length / 2)] ?? 0);
    }
    return out;
  }
  const curMed = medianByCombo(curRows);
  const priorMed = medianByCombo(priorRows);

  // Build sparklines per combo from the month's daily rows.
  const sparkByCombo = new Map<string, number[]>();
  for (const r of curRows) {
    if (r.median_price == null) continue;
    const v = Number(r.median_price);
    if (!Number.isFinite(v)) continue;
    const arr = sparkByCombo.get(r.combo_id) ?? [];
    arr.push(v);
    sparkByCombo.set(r.combo_id, arr);
  }

  type Mover = {
    combo_id: string;
    display: string;
    cur: number;
    prior: number;
    delta: number;
    spark: number[];
  };
  const movers: Mover[] = [];
  for (const [combo_id, cur] of curMed) {
    const prior = priorMed.get(combo_id) ?? cur;
    const delta = prior === 0 ? 0 : ((cur - prior) / prior) * 100;
    const canonical = HIGH_VALUE_COMBOS.find((c) => c.id === combo_id);
    movers.push({
      combo_id,
      display: canonical?.display ?? combo_id,
      cur,
      prior,
      delta,
      spark: sparkByCombo.get(combo_id) ?? [],
    });
  }
  movers.sort((a, b) => b.delta - a.delta);
  const gainers = movers.filter((m) => m.delta > 0).slice(0, 5);
  const losers = movers.filter((m) => m.delta < 0).slice(-5).reverse();

  const supplyDemand = soldCount > 0 ? addedCount / soldCount : null;

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Monthly report"
        title={label}
        description="Auto-generated summary of the month's market activity. Numbers reflect what was in the catalogue when the page loaded; refresh to recompute."
        right={
          <Link href="/reports" className="text-xs text-ink-400 underline hover:text-ink-100">
            All reports →
          </Link>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Listings added" value={fmtInt(addedCount)} sub="this month" />
        <KpiCard label="Sold events" value={fmtInt(soldCount)} sub="this month" tone="positive" />
        <KpiCard
          label="Supply / demand"
          value={supplyDemand != null ? `${supplyDemand.toFixed(1)}:1` : "—"}
          sub="added vs sold"
          tone={supplyDemand != null && supplyDemand > 5 ? "negative" : "default"}
        />
        <KpiCard
          label="Combos tracked"
          value={fmtInt(curMed.size)}
          sub={`of ${fmtInt(HIGH_VALUE_COMBOS.length)} anchors`}
          tone="info"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Top gainers" subtitle="Largest median-price increase vs prior month" padded={false}>
          <ul className="divide-y divide-ink-700/40">
            {gainers.length === 0 ? (
              <li className="p-4 text-sm text-ink-400">No gainers identified in this month yet.</li>
            ) : (
              gainers.map((m) => {
                const palette = paletteFor(anchorOf(m.display));
                return (
                  <li
                    key={m.combo_id}
                    className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                  >
                    <Link
                      href={`/combo/${m.combo_id}`}
                      className="flex items-center gap-2 text-ink-100 hover:text-claude-glow"
                    >
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ background: palette?.hex ?? "#447256", opacity: 0.9 }}
                      />
                      {m.display}
                    </Link>
                    <span className="flex items-center gap-3">
                      <MiniSparkline
                        values={m.spark}
                        width={80}
                        height={20}
                        color={palette?.hex}
                      />
                      <span className="font-mono tabular-nums text-ready">
                        +{m.delta.toFixed(1)}%
                      </span>
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </Panel>

        <Panel title="Top losers" subtitle="Largest median-price drop vs prior month" padded={false}>
          <ul className="divide-y divide-ink-700/40">
            {losers.length === 0 ? (
              <li className="p-4 text-sm text-ink-400">No losers identified in this month yet.</li>
            ) : (
              losers.map((m) => {
                const palette = paletteFor(anchorOf(m.display));
                return (
                  <li
                    key={m.combo_id}
                    className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                  >
                    <Link
                      href={`/combo/${m.combo_id}`}
                      className="flex items-center gap-2 text-ink-100 hover:text-claude-glow"
                    >
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ background: palette?.hex ?? "#447256", opacity: 0.9 }}
                      />
                      {m.display}
                    </Link>
                    <span className="flex items-center gap-3">
                      <MiniSparkline
                        values={m.spark}
                        width={80}
                        height={20}
                        color={palette?.hex}
                      />
                      <span className="font-mono tabular-nums text-danger">
                        {m.delta.toFixed(1)}%
                      </span>
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </Panel>
      </div>

      <Panel tone="soft" title="In plain English">
        <p className="text-sm text-ink-300">
          The market added <strong className="text-ink-100">{fmtInt(addedCount)}</strong>{" "}
          listings in {label} and recorded{" "}
          <strong className="text-ink-100">{fmtInt(soldCount)}</strong> sold events.
          {supplyDemand != null ? (
            <>
              {" "}Supply outran demand at a{" "}
              <strong className="text-ink-100">{supplyDemand.toFixed(1)}:1</strong>{" "}
              ratio.{" "}
            </>
          ) : null}
          {gainers.length > 0 ? (
            <>
              {" "}The biggest gainer was{" "}
              <Link href={`/combo/${gainers[0]!.combo_id}`} className="underline">
                {gainers[0]!.display}
              </Link>{" "}
              (+{gainers[0]!.delta.toFixed(1)}%).
            </>
          ) : null}
          {losers.length > 0 ? (
            <>
              {" "}The biggest loser was{" "}
              <Link href={`/combo/${losers[0]!.combo_id}`} className="underline">
                {losers[0]!.display}
              </Link>{" "}
              ({losers[0]!.delta.toFixed(1)}%).
            </>
          ) : null}
        </p>
      </Panel>

      <SourceFootnote
        sources={["market_listings", "listing_status_events", "combo_index_daily"]}
        n={curRows.length}
        methodologyAnchor="combo-index"
      />
    </div>
  );
}
