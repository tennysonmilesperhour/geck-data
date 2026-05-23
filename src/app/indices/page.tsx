// /indices — composite-index dashboard. Now data-driven, no curated
// allowlist of which morphs or combos appear.
//
// Anchor tiles (top of page) read from v_observed_traits (migration
// 0037) and show the top 8 morph families by listing count. Per-combo
// table reads from v_combo_index_summary which is keyed by the
// auto-discovered "Trait A x Trait B" combo name (350+ combos
// observed, up from a hardcoded 12).
//
// URL state: ?min=N narrows the table to combos with at least N total
// observations; defaults to 5. ?limit=N caps the table height.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtUsd, fmtInt } from "@/lib/format";
import { Panel, SectionHeader } from "@/components/ui/Panel";
import MiniSparkline from "@/components/charts/MiniSparkline";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { serverHref } from "@/lib/filters/link";
import { colorForTrait } from "@/lib/market/anchors";
import CsvDownloadButton from "@/components/ui/CsvDownloadButton";
import SourceFootnote from "@/components/ui/SourceFootnote";
import { comboSlugFromId } from "@/lib/market/combo-slug";

export const dynamic = "force-dynamic";

type ObservedTrait = {
  trait: string;
  n: number | string;
  median_price: number | string | null;
};

type ComboSummary = {
  combo_id: string;
  latest_day: string | null;
  current_value: number | string | null;
  latest_n: number | string | null;
  total_n: number | string | null;
  delta_7d: number | string | null;
  delta_30d: number | string | null;
  delta_90d: number | string | null;
};

type ComboDailyRow = {
  combo_id: string;
  day: string;
  median_price: number | string | null;
};

function comboTraits(combo_id: string): [string, string] | null {
  const parts = combo_id.split(/\s+x\s+/);
  if (parts.length !== 2) return null;
  return [parts[0]!.trim(), parts[1]!.trim()];
}

export default async function IndicesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const minN = Math.max(
    1,
    Number((searchParams?.min as string) ?? "") || 5,
  );
  const limit = Math.min(
    500,
    Math.max(10, Number((searchParams?.limit as string) ?? "") || 80),
  );

  const supabase = createClient();

  const [traitsRes, comboRes, sparkRes] = await Promise.all([
    supabase
      .from("v_observed_traits")
      .select("trait, n, median_price")
      .order("n", { ascending: false })
      .limit(40),
    supabase
      .from("v_combo_index_summary")
      .select(
        "combo_id, latest_day, current_value, latest_n, total_n, delta_7d, delta_30d, delta_90d",
      )
      .limit(2000),
    supabase
      .from("combo_index_daily")
      .select("combo_id, day, median_price")
      .gte(
        "day",
        new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10),
      )
      .order("day", { ascending: true })
      .limit(20000),
  ]);

  const traitRows = (traitsRes.data ?? []) as ObservedTrait[];
  const comboRows = (comboRes.data ?? []) as ComboSummary[];
  const sparkRows = (sparkRes.data ?? []) as ComboDailyRow[];

  // Anchor tiles: top 8 traits by sample size.
  const anchors = traitRows.slice(0, 8).map((t) => ({
    name: t.trait,
    n: Number(t.n ?? 0),
    median: Number(t.median_price ?? 0),
  }));

  // Per-combo sparkline keyed by combo_id (the "A x B" string).
  const sparkByCombo = new Map<string, number[]>();
  for (const r of sparkRows) {
    if (r.median_price == null) continue;
    const v = Number(r.median_price);
    if (!Number.isFinite(v)) continue;
    const arr = sparkByCombo.get(r.combo_id) ?? [];
    arr.push(v);
    sparkByCombo.set(r.combo_id, arr);
  }

  const filtered = comboRows
    .filter((r) => Number(r.total_n ?? r.latest_n ?? 0) >= minN)
    .map((r) => {
      const traits = comboTraits(r.combo_id);
      const dominant = traits ? traits[0]! : r.combo_id;
      return {
        ...r,
        traits,
        dominant,
        spark: sparkByCombo.get(r.combo_id) ?? [],
      };
    })
    .sort(
      (a, b) =>
        Number(b.total_n ?? b.latest_n ?? 0) -
        Number(a.total_n ?? a.latest_n ?? 0),
    )
    .slice(0, limit);

  const traitGalleryHref = (min: number): string => {
    const q = new URLSearchParams(
      Object.entries(searchParams ?? {})
        .map(([k, v]) => [k, Array.isArray(v) ? v[0]! : v ?? ""])
        .filter(([, v]) => v) as [string, string][],
    );
    q.set("min", String(min));
    return `/indices?${q.toString()}`;
  };

  const comboCols: Column<typeof filtered[number]>[] = [
    {
      key: "combo",
      header: "Combo",
      render: (r) => {
        const palette = colorForTrait(r.dominant);
        return (
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ background: palette.hex, opacity: 0.9 }}
              title={r.dominant}
            />
            <Link
              href={serverHref(`/combo/${comboSlugFromId(r.combo_id)}`, searchParams)}
              className="text-ink-100 hover:text-claude-glow"
            >
              {r.combo_id}
            </Link>
          </span>
        );
      },
    },
    {
      key: "value",
      header: "Current median",
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
      render: (r) =>
        r.spark.length > 1 ? (
          <MiniSparkline
            values={r.spark}
            width={120}
            height={26}
            color={colorForTrait(r.dominant).hex}
          />
        ) : (
          <span className="text-ink-600">—</span>
        ),
    },
    {
      key: "n",
      header: "n",
      align: "right",
      render: (r) => (
        <span className="font-mono tabular-nums text-ink-400">
          {r.total_n ? fmtInt(Number(r.total_n)) : fmtInt(Number(r.latest_n))}
        </span>
      ),
    },
  ];

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Indices"
        title="Composite market indices"
        description="Every morph family and every two-trait combo we observe in the listings stream, with current median, 7/30/90 day deltas, and a 90d sparkline. The dashboard auto-discovers combos from cached_traits; nothing is hand-picked."
        right={
          <Link href="/methodology#combo-index" className="text-xs text-ink-400 underline hover:text-ink-100">
            Methodology →
          </Link>
        }
      />

      <Panel
        tone="soft"
        title="Anchor morph families"
        subtitle="Top 8 morph traits by listing count, each linking to its trait page. The four-up tile band has been replaced with this because every additional family deserves a tile."
      >
        {anchors.length === 0 ? (
          <p className="text-sm text-ink-400">
            No trait observations yet. Add data via /upload or wait for the
            scheduled scrape.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {anchors.map((a) => {
              const palette = colorForTrait(a.name);
              return (
                <Link
                  key={a.name}
                  href={serverHref(
                    `/trait/${a.name.toLowerCase().replace(/\s+/g, "-")}`,
                    searchParams,
                  )}
                  className="relative overflow-hidden rounded-lg border border-ink-700 bg-ink-800 p-3 transition hover:border-ink-600"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${palette.soft} 0%, transparent 65%)`,
                  }}
                >
                  <div
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1"
                    style={{ background: palette.hex, opacity: 0.9 }}
                  />
                  <div className="relative font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: palette.text }}>
                    {a.name}
                  </div>
                  <div className="relative mt-1 font-display text-[22px] font-medium tabular-nums text-ink-50">
                    {a.median ? fmtUsd(a.median) : "—"}
                  </div>
                  <div className="relative mt-0.5 font-mono text-[11px] text-ink-400">
                    {fmtInt(a.n)} listings · median
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="Per-combo indices"
        subtitle={`Auto-discovered two-trait combinations. Showing ${fmtInt(filtered.length)} of ${fmtInt(comboRows.length)} known combos with at least ${fmtInt(minN)} observations. Click any combo for its detail page.`}
        padded={false}
        right={
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10px] uppercase tracking-wider text-ink-500 md:inline">
              min n
            </span>
            <div className="inline-flex overflow-hidden rounded-md border border-ink-700 text-[11px]">
              {[1, 3, 5, 10, 25].map((m) => {
                const active = m === minN;
                return (
                  <Link
                    key={m}
                    href={traitGalleryHref(m)}
                    className={`px-2 py-1 font-mono ${
                      active
                        ? "bg-ready/15 text-ready"
                        : "text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                    }`}
                  >
                    {m}+
                  </Link>
                );
              })}
            </div>
            <CsvDownloadButton
              rows={filtered.map((r) => ({
                combo_id: r.combo_id,
                latest_day: r.latest_day,
                current_value: r.current_value,
                delta_7d: r.delta_7d,
                delta_30d: r.delta_30d,
                delta_90d: r.delta_90d,
                latest_n: r.latest_n,
                total_n: r.total_n,
              }))}
              filename={`indices-${new Date().toISOString().slice(0, 10)}`}
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-400">
            No combos meet the current filter. Try a lower &quot;min n&quot;.
          </div>
        ) : (
          <DataTable
            columns={comboCols}
            rows={filtered}
            rowKey={(r) => r.combo_id}
          />
        )}
      </Panel>

      <Panel tone="soft" title="Why these morphs?">
        <p className="text-sm text-ink-300">
          The list above is generated from{" "}
          <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">v_observed_traits</code>{" "}
          and{" "}
          <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">v_combo_index_summary</code>{" "}
          (migration 0037). Every morph trait that appears on at least
          three listings shows up; every two-trait combination that
          co-occurs on at least three listings shows up. Use the{" "}
          <strong className="text-ink-100">min n</strong> chip group above
          to widen or narrow the cutoff.
        </p>
        <p className="mt-2 text-sm text-ink-300">
          There is no curated allowlist. If you see a morph you expect to
          appear and it is missing, it means we have fewer than three
          listings carrying that trait in the current catalogue.
        </p>
      </Panel>

      <SourceFootnote
        sources={[
          "v_observed_traits",
          "v_combo_index_summary",
          "combo_index_daily",
          "price_history",
        ]}
        n={comboRows.length}
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
