// Profitability tiers — top combos ranked by expected revenue
// (effective_price × sell_through_rate). Source data is the
// v_combo_profitability(window_days) function in migration 0019.
//
// Tier bucketing: take the top 25 combos with at least one sold event,
// sort by score, bucket into 5 tiers of 5 each. The function itself
// returns raw scores; tier cutoffs live here so we can adjust the
// presentation without a migration.
import { Panel } from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtUsd, fmtPct } from "@/lib/format";

type Row = {
  combo_name: string;
  combo_source: "anchor" | "discovered";
  sold_count: number;
  live_count: number;
  median_sold: number | null;
  median_ask: number | null;
  sell_through_rate: number;
  effective_price: number;
  score: number;
  confidence: number;
};

const TIER_META: Array<{
  rank: number;
  label: string;
  headline: string;
  cls: string;
}> = [
  {
    rank: 1,
    label: "Tier 1",
    headline: "Highest expected revenue",
    cls: "border-ready/60 bg-gradient-to-br from-ready/8 to-transparent",
  },
  {
    rank: 2,
    label: "Tier 2",
    headline: "Strong",
    cls: "border-ready/30 bg-gradient-to-br from-ready/4 to-transparent",
  },
  {
    rank: 3,
    label: "Tier 3",
    headline: "Above average",
    cls: "border-ink-700 bg-ink-850/40",
  },
  {
    rank: 4,
    label: "Tier 4",
    headline: "Mid-pack",
    cls: "border-ink-700 bg-ink-850/30",
  },
  {
    rank: 5,
    label: "Tier 5",
    headline: "Bottom of ranked",
    cls: "border-busy/30 bg-gradient-to-br from-busy/4 to-transparent",
  },
];

const COMBOS_PER_TIER = 5;

async function fetchTiers(
  windowDays: number,
): Promise<{ rows: Row[]; insufficient: number }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("v_combo_profitability", {
    p_window_days: windowDays,
    p_min_top_trait_n: 25,
    p_min_pair_listings: 20,
  });
  if (error) {
    console.warn("v_combo_profitability rpc failed:", error.message);
    return { rows: [], insufficient: 0 };
  }
  type Raw = {
    combo_name: string;
    combo_source: string;
    sold_count: number;
    live_count: number;
    median_sold: string | number | null;
    median_ask: string | number | null;
    sell_through_rate: string | number;
    effective_price: string | number;
    score: string | number;
    confidence: number;
  };
  const raw = (data ?? []) as Raw[];
  const all: Row[] = raw.map((r) => ({
    combo_name: r.combo_name,
    combo_source:
      r.combo_source === "anchor" ? "anchor" : "discovered",
    sold_count: r.sold_count,
    live_count: r.live_count,
    median_sold: r.median_sold == null ? null : Number(r.median_sold),
    median_ask: r.median_ask == null ? null : Number(r.median_ask),
    sell_through_rate: Number(r.sell_through_rate),
    effective_price: Number(r.effective_price),
    score: Number(r.score),
    confidence: r.confidence,
  }));
  // Eligible for ranking: at least one sold event in the window. The
  // others are surfaced as "watch list" insufficient-data combos in a
  // footnote so the user knows what's being held back.
  const ranked = all
    .filter((r) => r.sold_count > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TIER_META.length * COMBOS_PER_TIER);
  return {
    rows: ranked,
    insufficient: all.length - ranked.length,
  };
}

function ComboRow({ row, index }: { row: Row; index: number }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto_auto] items-baseline gap-3 py-1.5 font-sans text-sm">
      <span className="font-mono text-[11px] text-ink-500 tabular-nums">
        {index + 1}.
      </span>
      <span className="truncate text-ink-100">
        {row.combo_name}
        {row.combo_source === "anchor" ? (
          <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ready/70">
            anchor
          </span>
        ) : null}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-ink-300">
        {fmtUsd(row.effective_price)}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-ink-300">
        {fmtPct(row.sell_through_rate * 100, 1)}
      </span>
      <span
        className="font-mono text-[11px] tabular-nums text-ink-400"
        title={`${row.sold_count} sold / ${row.live_count} live · confidence ${row.confidence}/99`}
      >
        n={row.sold_count + row.live_count}
      </span>
    </li>
  );
}

export default async function ProfitabilityTiers({
  windowDays = 90,
}: {
  windowDays?: number;
}) {
  const { rows, insufficient } = await fetchTiers(windowDays);

  if (rows.length === 0) {
    return (
      <Panel
        title={`Profitability tiers · last ${windowDays} days`}
        subtitle="Top combos ranked by expected revenue per listing (price × sell-through). Not enough sold data yet to rank — the catalog needs more sold events to surface this view."
      >
        <p className="text-sm text-ink-400">
          {insufficient > 0
            ? `${fmtInt(insufficient)} combos meet the size threshold but have no sold events in the window yet.`
            : "No combos meet the threshold yet."}
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title={`Profitability tiers · last ${windowDays} days`}
      subtitle="Combos ranked by expected revenue per listing: effective price × sell-through rate (sold ÷ (sold + live)). Anchor combos are from the curated catalog; the rest are auto-discovered top trait pairs. Hover the count for sample sizes + confidence."
      right={
        <span className="font-mono text-[11px]">
          {fmtInt(rows.length)} of top combos
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {TIER_META.map((tier) => {
          const start = (tier.rank - 1) * COMBOS_PER_TIER;
          const slice = rows.slice(start, start + COMBOS_PER_TIER);
          if (slice.length === 0) return null;
          const top = slice[0]!;
          const bottom = slice[slice.length - 1]!;
          return (
            <div
              key={tier.rank}
              className={`rounded-lg border ${tier.cls} p-3`}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
                    {tier.label}
                  </div>
                  <div className="text-[13px] font-medium text-ink-50">
                    {tier.headline}
                  </div>
                </div>
                <div className="text-right font-mono text-[10px] tabular-nums text-ink-400">
                  <div>score</div>
                  <div className="text-ink-200">
                    {bottom.score.toFixed(0)}–{top.score.toFixed(0)}
                  </div>
                </div>
              </div>
              <div className="mb-1 grid grid-cols-[28px_minmax(0,1fr)_auto_auto_auto] gap-3 border-b border-ink-700/40 pb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-500">
                <span />
                <span>combo</span>
                <span className="text-right">price</span>
                <span className="text-right">sell-thru</span>
                <span className="text-right">n</span>
              </div>
              <ul className="divide-y divide-ink-700/30">
                {slice.map((row, i) => (
                  <ComboRow key={row.combo_name} row={row} index={start + i} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {insufficient > 0 ? (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
          + {fmtInt(insufficient)} watch-list combos with no sold events
          yet — price exists, velocity unknown.
        </p>
      ) : null}
    </Panel>
  );
}

export function ProfitabilityTiersSkeleton() {
  return (
    <div className="surface p-5" aria-label="Loading profitability tiers">
      <div className="mb-3 h-5 w-56 animate-pulse rounded bg-ink-800" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-lg border border-ink-700 bg-ink-850/40"
          />
        ))}
      </div>
    </div>
  );
}
