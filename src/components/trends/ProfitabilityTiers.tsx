// Profitability tiers — top combos ranked by expected revenue
// (effective_price × sell_through_rate). Source data is the
// v_combo_profitability(window_days) function in migration 0019.
//
// Layout: each of 5 tiers is its own row across the full panel width
// rather than a 5-up grid of narrow cards. The previous 5-up layout
// truncated combo names like "Partial Pinstripe × Snowflake" to a few
// letters; row-per-tier gives names full breathing room and matches
// the way the user reads the ranking (top to bottom).
//
// Each combo cell exposes a hover popover with the full per-combo
// readout (median sold, median ask, sold/live counts, confidence,
// source). Popover uses the same z-50 / CSS-only group-hover pattern
// as MorphTerm, so no client JS is needed.
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
  borderCls: string;
  labelCls: string;
}> = [
  {
    rank: 1,
    label: "Tier 1",
    headline: "Highest expected revenue",
    borderCls: "border-ready/60 bg-ready/[0.06]",
    labelCls: "text-ready",
  },
  {
    rank: 2,
    label: "Tier 2",
    headline: "Strong",
    borderCls: "border-ready/30 bg-ready/[0.03]",
    labelCls: "text-ready",
  },
  {
    rank: 3,
    label: "Tier 3",
    headline: "Above average",
    borderCls: "border-ink-700 bg-ink-850/40",
    labelCls: "text-ink-200",
  },
  {
    rank: 4,
    label: "Tier 4",
    headline: "Mid-pack",
    borderCls: "border-ink-700 bg-ink-850/30",
    labelCls: "text-ink-300",
  },
  {
    rank: 5,
    label: "Tier 5",
    headline: "Bottom of ranked",
    borderCls: "border-busy/30 bg-busy/[0.04]",
    labelCls: "text-busy",
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
    combo_source: r.combo_source === "anchor" ? "anchor" : "discovered",
    sold_count: r.sold_count,
    live_count: r.live_count,
    median_sold: r.median_sold == null ? null : Number(r.median_sold),
    median_ask: r.median_ask == null ? null : Number(r.median_ask),
    sell_through_rate: Number(r.sell_through_rate),
    effective_price: Number(r.effective_price),
    score: Number(r.score),
    confidence: r.confidence,
  }));
  const ranked = all
    .filter((r) => r.sold_count > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TIER_META.length * COMBOS_PER_TIER);
  return { rows: ranked, insufficient: all.length - ranked.length };
}

function ComboCell({ row, index }: { row: Row; index: number }) {
  return (
    <div className="group relative" tabIndex={0}>
      <div className="flex items-baseline gap-2 rounded-md border border-ink-700/40 bg-ink-900/40 px-3 py-2 transition hover:border-ink-600 hover:bg-ink-850 group-focus:border-ink-600 group-focus:bg-ink-850">
        <span className="w-7 shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
          #{index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="break-words text-sm text-ink-100">
              {row.combo_name}
            </span>
            {row.combo_source === "anchor" ? (
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-ready/70">
                anchor
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums text-ink-400">
            <span>
              <span className="text-ink-200">{fmtUsd(row.effective_price)}</span>
            </span>
            <span>
              <span className="text-ink-200">
                {fmtPct(row.sell_through_rate * 100, 1)}
              </span>{" "}
              sell-thru
            </span>
            <span>n={row.sold_count + row.live_count}</span>
          </div>
        </div>
      </div>

      {/* Hover popover: full readout. Uses the same z-50 / CSS-only
          group-hover pattern as MorphTerm. pointer-events-none so it
          doesn't intercept hover/click on adjacent rows. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 right-0 top-full z-50 mt-1 hidden rounded-lg border border-ink-700 bg-ink-900/95 p-3 text-left text-xs leading-relaxed text-ink-200 shadow-glow backdrop-blur group-hover:block group-focus-within:block"
      >
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="font-display text-[13px] font-medium text-ink-50">
            {row.combo_name}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-500">
            {row.combo_source}
          </span>
        </div>
        <dl className="space-y-1 font-mono text-[11px] tabular-nums">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-400">Effective price</dt>
            <dd className="text-ink-100">{fmtUsd(row.effective_price)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-400">Median sold</dt>
            <dd className="text-ink-200">
              {row.median_sold != null ? fmtUsd(row.median_sold) : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-400">Median ask</dt>
            <dd className="text-ink-200">
              {row.median_ask != null ? fmtUsd(row.median_ask) : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-400">Sell-through</dt>
            <dd className="text-ink-200">
              {fmtPct(row.sell_through_rate * 100, 1)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-400">Sold / live</dt>
            <dd className="text-ink-200">
              {fmtInt(row.sold_count)} / {fmtInt(row.live_count)}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-ink-700/60 pt-1">
            <dt className="text-ink-400">Score</dt>
            <dd className="font-semibold text-ink-50">
              {row.score.toFixed(1)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-400">Confidence</dt>
            <dd className="text-ink-300">{row.confidence}/99</dd>
          </div>
        </dl>
        <p className="mt-2 text-[10px] leading-snug text-ink-500">
          Effective price uses median sold when available, otherwise
          median ask × 0.8 (typical clearing haircut). Score = effective
          price × sell-through.
        </p>
      </span>
    </div>
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
      subtitle="Combos ranked by expected revenue per listing: effective price × sell-through rate (sold ÷ (sold + live)). Hover any combo for the full readout. Anchor combos are from the curated catalog; the rest are auto-discovered top trait pairs."
      right={
        <span className="font-mono text-[11px]">
          {fmtInt(rows.length)} combos · {TIER_META.length} tiers
        </span>
      }
    >
      <div className="space-y-3">
        {TIER_META.map((tier) => {
          const start = (tier.rank - 1) * COMBOS_PER_TIER;
          const slice = rows.slice(start, start + COMBOS_PER_TIER);
          if (slice.length === 0) return null;
          const top = slice[0]!;
          const bottom = slice[slice.length - 1]!;
          return (
            <div
              key={tier.rank}
              className={`rounded-lg border p-3 ${tier.borderCls}`}
            >
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.14em] ${tier.labelCls}`}
                  >
                    {tier.label}
                  </span>
                  <span className="text-[13px] font-medium text-ink-50">
                    {tier.headline}
                  </span>
                </div>
                <span className="font-mono text-[10px] tabular-nums text-ink-400">
                  score {bottom.score.toFixed(0)}–{top.score.toFixed(0)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
                {slice.map((row, i) => (
                  <ComboCell
                    key={row.combo_name}
                    row={row}
                    index={start + i}
                  />
                ))}
              </div>
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
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg border border-ink-700 bg-ink-850/40"
          />
        ))}
      </div>
    </div>
  );
}
