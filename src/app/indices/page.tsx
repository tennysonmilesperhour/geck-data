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
import {
  isRedundantComboName,
  redundantComboKeys,
} from "@/lib/market/combo-redundancy";

export const dynamic = "force-dynamic";

// A pair carried by a single seller is that seller's pricing, not a market.
const MIN_SELLERS = 2;

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
  // Added in migration 0044 so a null delta can explain itself. A blank cell
  // used to be indistinguishable from a measured 0.0%, which is exactly the
  // confusion the audit caught: every delta on this page read "+0.0%" because
  // the priors were anchored on CURRENT_DATE and matched each combo's own
  // latest row.
  observed_days: number | string | null;
  first_day: string | null;
  is_stale: boolean | null;
  latest_age_days: number | string | null;
  baseline_90d_day: string | null;
  baseline_90d_lag_days: number | string | null;
};

// Evidence breadth per pair (migration 0046). Two labels that are really one
// trait (Extreme Harlequin with Harlequin, Dalmatian with Super Dalmatian)
// are not a combo, and a pair carried by one seller is not a market.
type ComboBreadth = {
  combo_id: string;
  n_listings: number | string | null;
  n_sellers: number | string | null;
  is_redundant_pair: boolean | null;
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

  const [traitsRes, comboRes, sparkRes, breadthRes] = await Promise.all([
    supabase
      .from("v_observed_traits")
      .select("trait, n, median_price")
      .order("n", { ascending: false })
      .limit(40),
    supabase
      .from("v_combo_index_summary")
      .select(
        "combo_id, latest_day, current_value, latest_n, total_n, delta_7d, delta_30d, delta_90d, observed_days, first_day, is_stale, latest_age_days, baseline_90d_day, baseline_90d_lag_days",
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
    supabase
      .from("v_combo_breadth")
      .select("combo_id, n_listings, n_sellers, is_redundant_pair")
      .limit(5000),
  ]);

  const traitRows = (traitsRes.data ?? []) as ObservedTrait[];
  const comboRows = (comboRes.data ?? []) as ComboSummary[];
  const sparkRows = (sparkRes.data ?? []) as ComboDailyRow[];
  const breadthRows = (breadthRes.data ?? []) as ComboBreadth[];
  const breadthByCombo = new Map(breadthRows.map((b) => [b.combo_id, b]));
  const redundantKeys = redundantComboKeys(breadthRows);

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

  // Two gates before a pair is charted at all, per the audit's release gates:
  // it must be a real pair (not one trait wearing two labels) and it must
  // carry independent evidence (more than one seller). 36 pairs are redundant
  // and the three largest of them, Extreme Harlequin x Harlequin at 209
  // listings, Red x Red Base and Dalmatian x Super Dalmatian at 136 each,
  // were ranking at the top of this table.
  const redundantHidden = comboRows.filter((r) =>
    isRedundantComboName(r.combo_id, redundantKeys),
  ).length;
  const thinHidden = comboRows.filter((r) => {
    const b = breadthByCombo.get(r.combo_id);
    return b?.is_redundant_pair !== true && Number(b?.n_sellers ?? 0) < MIN_SELLERS;
  }).length;

  const filtered = comboRows
    .filter((r) => Number(r.total_n ?? r.latest_n ?? 0) >= minN)
    .filter((r) => {
      if (isRedundantComboName(r.combo_id, redundantKeys)) return false;
      const b = breadthByCombo.get(r.combo_id);
      return Number(b?.n_sellers ?? 0) >= MIN_SELLERS;
    })
    .map((r) => {
      const traits = comboTraits(r.combo_id);
      const dominant = traits ? traits[0]! : r.combo_id;
      const b = breadthByCombo.get(r.combo_id);
      return {
        ...r,
        traits,
        dominant,
        spark: sparkByCombo.get(r.combo_id) ?? [],
        n_sellers: b?.n_sellers ?? null,
        n_listings_breadth: b?.n_listings ?? null,
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
          {r.current_value ? fmtUsd(Number(r.current_value)) : "no data"}
        </span>
      ),
    },
    {
      key: "d7",
      header: "7d",
      align: "right",
      render: (r) => <Delta n={r.delta_7d} stale={r.is_stale === true} />,
    },
    {
      key: "d30",
      header: "30d",
      align: "right",
      render: (r) => <Delta n={r.delta_30d} stale={r.is_stale === true} />,
    },
    {
      key: "d90",
      header: "90d",
      align: "right",
      render: (r) => <Delta n={r.delta_90d} stale={r.is_stale === true} />,
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
    {
      key: "sellers",
      header: "sellers",
      align: "right",
      render: (r) => (
        <span className="font-mono tabular-nums text-ink-400">
          {r.n_sellers == null ? "no data" : fmtInt(Number(r.n_sellers))}
        </span>
      ),
    },
    {
      key: "asof",
      header: "Last observed",
      align: "right",
      render: (r) => (
        <span
          className={`font-mono text-[11px] ${
            r.is_stale ? "text-busy" : "text-ink-400"
          }`}
          title={
            r.is_stale
              ? `No observation for ${fmtInt(Number(r.latest_age_days ?? 0))} days, so every delta is withheld`
              : undefined
          }
        >
          {r.latest_day ?? "no data"}
          {r.observed_days ? ` · ${fmtInt(Number(r.observed_days))}d obs` : ""}
        </span>
      ),
    },
  ];

  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Indices"
        title="Composite market indices"
        description="Median observed asking price per morph family and per two-trait combo, with the deltas we can actually measure and the date each was last observed. Combos are auto-discovered from trait tags; same-trait pairs and single-seller pairs are filtered out."
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
                    {a.median ? fmtUsd(a.median) : "no data"}
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
                n_sellers: r.n_sellers,
                observed_days: r.observed_days,
                is_stale: r.is_stale,
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

      <Panel tone="soft" title="What this table does and does not show">
        <p className="text-sm text-ink-300">
          Combos are discovered from listing trait tags, not hand-picked. Two
          filters run before anything is charted. A pair whose two labels are
          really the same trait is dropped, because Extreme Harlequin with
          Harlequin, Dalmatian with Super Dalmatian, or Axanthic with Het
          Axanthic is one trait described twice, not a pairing a breeder can
          make. A pair carried by fewer than {MIN_SELLERS} sellers is also
          dropped, because one breeder&apos;s asking prices are not a market.
          {redundantHidden + thinHidden > 0 ? (
            <>
              {" "}
              Right now that hides {fmtInt(redundantHidden)} same-trait{" "}
              {redundantHidden === 1 ? "pair" : "pairs"} and{" "}
              {fmtInt(thinHidden)} single-seller{" "}
              {thinHidden === 1 ? "pair" : "pairs"}.
            </>
          ) : null}
        </p>
        <p className="mt-2 text-sm text-ink-300">
          Deltas compare a combo against its own earlier observations, never
          against today&apos;s date. A cell reading{" "}
          <strong className="text-ink-100">no baseline</strong> means nothing
          was observed at the far end of that window, and{" "}
          <strong className="text-ink-100">stale</strong> means the combo has
          not been seen recently at all. Neither is a measured zero. Because
          collection stopped between 2026-06-10 and 2026-08-26, no combo
          currently has a 7 or 30 day baseline, and only the 90 day column has
          real comparisons in it.
        </p>
        <p className="mt-2 text-sm text-ink-300">
          Values are median observed asking prices in USD, one observation per
          listing per day, with multi-animal lots excluded. They are not sale
          prices.
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

// A null delta is not a zero. Since migration 0044 it means one of two
// specific things, and saying which is the whole point: either this combo has
// not been observed recently enough to compare, or nothing was observed at the
// far end of the labelled horizon because of the 78 day collection gap.
function Delta({
  n,
  stale = false,
}: {
  n: number | string | null | undefined;
  stale?: boolean;
}) {
  if (n == null) {
    return (
      <span
        className="text-ink-600"
        title={
          stale
            ? "Not measured: this combo has no recent observation"
            : "Not measured: no observation at the start of this window"
        }
      >
        {stale ? "stale" : "no baseline"}
      </span>
    );
  }
  const v = Number(n);
  if (!Number.isFinite(v)) return <span className="text-ink-600">no data</span>;
  const cls = v >= 0 ? "text-ready" : "text-danger";
  return (
    <span className={`font-mono tabular-nums ${cls}`}>
      {v >= 0 ? "+" : ""}
      {v.toFixed(1)}%
    </span>
  );
}
