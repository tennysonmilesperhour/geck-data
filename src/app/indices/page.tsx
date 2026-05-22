// /indices — composite-index dashboard.
//
// Lists the four anchor sub-indices (Lilly White, Harlequin, Axanthic,
// Cappuccino) at the top with current value, 7d / 30d delta, and a
// 26-week sparkline. Below, every canonical high-value combo with its
// own current value + 7d / 30d / 90d deltas, sourced from the
// v_combo_index_summary view (migration 0035).
//
// Server-rendered. URL state preserved for cross-page nav.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HIGH_VALUE_COMBOS } from "@/lib/market/combos";
import { fmtUsd, fmtPct, fmtInt } from "@/lib/format";
import { Panel, SectionHeader } from "@/components/ui/Panel";
import KpiCard from "@/components/ui/KpiCard";
import MiniSparkline from "@/components/charts/MiniSparkline";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { serverHref } from "@/lib/filters/link";
import { paletteFor, anchorOf, type AnchorKey } from "@/lib/market/anchors";
import CsvDownloadButton from "@/components/ui/CsvDownloadButton";
import SourceFootnote from "@/components/ui/SourceFootnote";

export const dynamic = "force-dynamic";

type SubIndexRow = {
  anchor: string;
  week_start: string;
  value: number | string | null;
  median_price: number | string | null;
  n: number | string;
};

type ComboSummary = {
  combo_id: string;
  latest_day: string | null;
  current_value: number | string | null;
  latest_n: number | string | null;
  delta_7d: number | string | null;
  delta_30d: number | string | null;
  delta_90d: number | string | null;
};

type ComboDailyRow = {
  combo_id: string;
  day: string;
  median_price: number | string | null;
};

export default async function IndicesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = createClient();

  const [subRes, comboRes, sparkRes] = await Promise.all([
    supabase.rpc("v_market_sub_index", { window_days: 180 }),
    supabase
      .from("v_combo_index_summary")
      .select("combo_id, latest_day, current_value, latest_n, delta_7d, delta_30d, delta_90d")
      .limit(50),
    supabase
      .from("combo_index_daily")
      .select("combo_id, day, median_price")
      .gte("day", new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10))
      .order("day", { ascending: true })
      .limit(5000),
  ]);

  const subRows = (subRes.data ?? []) as SubIndexRow[];
  const comboRows = (comboRes.data ?? []) as ComboSummary[];
  const sparkRows = (sparkRes.data ?? []) as ComboDailyRow[];

  // Group sub-index rows into series per anchor.
  type Anchor = { name: string; series: number[]; current: number; delta: number };
  const anchorMap = new Map<string, Anchor>();
  for (const r of subRows) {
    if (r.value == null) continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    const a = anchorMap.get(r.anchor) ?? { name: r.anchor, series: [], current: 0, delta: 0 };
    a.series.push(v);
    a.current = v;
    anchorMap.set(r.anchor, a);
  }
  for (const a of anchorMap.values()) {
    if (a.series.length < 2) continue;
    const start = a.series[0]!;
    a.delta = start === 0 ? 0 : ((a.current - start) / start) * 100;
  }
  const ANCHOR_ORDER = ["Lilly White", "Harlequin", "Axanthic", "Cappuccino"];
  const anchors = Array.from(anchorMap.values()).sort(
    (a, b) => ANCHOR_ORDER.indexOf(a.name) - ANCHOR_ORDER.indexOf(b.name),
  );

  // Per-combo sparkline values keyed by combo_id.
  const sparkByCombo = new Map<string, number[]>();
  for (const r of sparkRows) {
    if (r.median_price == null) continue;
    const v = Number(r.median_price);
    if (!Number.isFinite(v)) continue;
    const arr = sparkByCombo.get(r.combo_id) ?? [];
    arr.push(v);
    sparkByCombo.set(r.combo_id, arr);
  }

  // Enrich combo summary rows with display name + sparkline.
  const comboData = comboRows
    .map((r) => {
      const canonical = HIGH_VALUE_COMBOS.find((c) => c.id === r.combo_id);
      return {
        ...r,
        display: canonical?.display ?? r.combo_id,
        spark: sparkByCombo.get(r.combo_id) ?? [],
      };
    })
    .sort((a, b) => (Number(b.current_value ?? 0) - Number(a.current_value ?? 0)));

  const comboCols: Column<typeof comboData[number]>[] = [
    {
      key: "combo",
      header: "Combo",
      render: (r) => {
        const anchor = anchorOf(r.display);
        const palette = paletteFor(anchor);
        return (
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: palette?.hex ?? "#447256", opacity: 0.85 }}
              title={anchor ?? "unclassified"}
            />
            <Link
              href={serverHref(`/combo/${r.combo_id}`, searchParams)}
              className="text-ink-100 hover:text-claude-glow"
            >
              {r.display}
            </Link>
          </span>
        );
      },
    },
    {
      key: "value",
      header: "Current median sold",
      align: "right",
      render: (r) => (
        <span className="font-mono tabular-nums">
          {r.current_value ? fmtUsd(Number(r.current_value)) : "—"}
        </span>
      ),
    },
    {
      key: "d7",
      header: "7d",
      align: "right",
      render: (r) => <Delta n={r.delta_7d} />,
    },
    {
      key: "d30",
      header: "30d",
      align: "right",
      render: (r) => <Delta n={r.delta_30d} />,
    },
    {
      key: "d90",
      header: "90d",
      align: "right",
      render: (r) => <Delta n={r.delta_90d} />,
    },
    {
      key: "spark",
      header: "90d trend",
      align: "right",
      render: (r) => {
        if (r.spark.length <= 1) return <span className="text-ink-600">—</span>;
        const palette = paletteFor(anchorOf(r.display));
        return (
          <MiniSparkline
            values={r.spark}
            width={120}
            height={26}
            color={palette?.hex}
          />
        );
      },
    },
    {
      key: "n",
      header: "n",
      align: "right",
      render: (r) => (
        <span className="font-mono tabular-nums text-ink-400">
          {r.latest_n ? fmtInt(Number(r.latest_n)) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Indices"
        title="Composite market indices"
        description="One number per family. Anchor sub-indices rebase to 1000 at the window start; per-combo rows show the actual median sold price with 7/30/90 day deltas. See methodology for the math."
        right={
          <Link href="/methodology#combo-index" className="text-xs text-ink-400 underline hover:text-ink-100">
            Methodology →
          </Link>
        }
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {anchors.length === 0 ? (
          <div className="col-span-full rounded-md border border-dashed border-ink-700 bg-ink-850 p-6 text-center text-sm text-ink-400">
            Sub-index view is empty. Run migration 0035 or refresh
            v_market_sub_index source data.
          </div>
        ) : (
          anchors.map((a) => {
            const palette = paletteFor(a.name as AnchorKey);
            const accent = palette?.hex ?? "#0e9a73";
            const labelTint = palette?.text ?? "#aebfb5";
            const bgTint = palette?.soft ?? "transparent";
            return (
              <Link
                key={a.name}
                href={serverHref(`/trait/${a.name.toLowerCase().replace(/\s+/g, "-")}`, searchParams)}
                className="relative overflow-hidden rounded-lg border border-ink-700 bg-ink-800 p-4 shadow-panel transition hover:border-ink-600"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${bgTint} 0%, transparent 65%)`,
                }}
              >
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: accent, opacity: 0.9 }}
                />
                <div className="relative flex items-baseline justify-between gap-2">
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.14em]"
                    style={{ color: labelTint }}
                  >
                    {a.name}
                  </span>
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      a.delta >= 0 ? "text-ready" : "text-danger"
                    }`}
                  >
                    {a.delta >= 0 ? "▲" : "▼"} {Math.abs(a.delta).toFixed(1)}%
                  </span>
                </div>
                <div className="relative mt-1 font-display text-[24px] font-medium tabular-nums text-ink-50">
                  {Math.round(a.current).toLocaleString()}
                </div>
                <div className="relative mt-2 -mx-1">
                  <MiniSparkline
                    values={a.series}
                    width={220}
                    height={56}
                    fill
                    color={accent}
                  />
                </div>
                <div className="relative mt-1 text-[10px] text-ink-500">
                  rebased to 1000 at window start · 180d
                </div>
              </Link>
            );
          })
        )}
      </section>

      <Panel
        title="Per-combo indices"
        subtitle="Daily median sold price plus 7d / 30d / 90d trailing deltas, sourced from combo_index_daily. Click any combo to land on its entity page."
        padded={false}
        right={
          <CsvDownloadButton
            rows={comboData.map((r) => ({
              combo_id: r.combo_id,
              display: r.display,
              latest_day: r.latest_day,
              current_value: r.current_value,
              delta_7d: r.delta_7d,
              delta_30d: r.delta_30d,
              delta_90d: r.delta_90d,
              latest_n: r.latest_n,
            }))}
            filename={`indices-${new Date().toISOString().slice(0, 10)}`}
          />
        }
      >
        {comboData.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-400">
            combo_index_daily is empty. Apply migration 0035 and refresh
            the materialised view (refresh_combo_index_daily()).
          </div>
        ) : (
          <DataTable columns={comboCols} rows={comboData} rowKey={(r) => r.combo_id} />
        )}
      </Panel>

      <SourceFootnote
        sources={["combo_index_daily", "v_market_sub_index", "price_history"]}
        n={comboData.length}
        methodologyAnchor="combo-index"
      />
    </div>
  );
}

function Delta({ n }: { n: number | string | null | undefined }) {
  if (n == null) return <span className="text-ink-600">—</span>;
  const v = Number(n);
  if (!Number.isFinite(v)) return <span className="text-ink-600">—</span>;
  const cls = v >= 0 ? "text-ready" : "text-danger";
  return (
    <span className={`font-mono tabular-nums ${cls}`}>
      {v >= 0 ? "+" : ""}
      {v.toFixed(1)}%
    </span>
  );
}
