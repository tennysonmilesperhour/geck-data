// Profitability tiers — top combos ranked by expected revenue
// (effective_price × sell_through_rate). Source data is the
// v_combo_profitability(window_days, min_top_trait_n, min_pair_listings,
// min_sold_count) function in migration 0022.
//
// Two presentation layers:
//
//   1. Ranked tiers (5 rows). Combos with at least one Tier 1 or Tier 2
//      trait — a real value-driver paired with anything. Bucketed into
//      5 tiers by score.
//
//   2. Incidental combos. Combos whose tokens are both Tier 3 cosmetic
//      descriptors (e.g. "Snowflake × Tri-Color"). These ride the
//      coat-tails of high-value listings — buyers don't actually shop
//      for these pairings, the tokens just co-occur on premium geckos.
//      Surfaced separately, not as a value signal.
//
// The primary_token field tells us which side of the pair is the
// value-driver, so the hover tooltip can call it out as the "drives
// value" trait and the other token as the "complements with" trait.
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
  combo_rank: number;
  is_incidental: boolean;
  primary_token: string | null;
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
const INCIDENTAL_LIMIT = 10;
const MIN_SOLD_COUNT = 3;

async function fetchTiers(
  windowDays: number,
): Promise<{
  ranked: Row[];
  incidental: Row[];
  insufficient: number;
}> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("v_combo_profitability", {
    p_window_days: windowDays,
    p_min_top_trait_n: 25,
    p_min_pair_listings: 20,
    p_min_sold_count: MIN_SOLD_COUNT,
  });
  if (error) {
    console.warn("v_combo_profitability rpc failed:", error.message);
    return { ranked: [], incidental: [], insufficient: 0 };
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
    combo_rank: number;
    is_incidental: boolean;
    primary_token: string | null;
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
    combo_rank: r.combo_rank,
    is_incidental: r.is_incidental,
    primary_token: r.primary_token,
  }));
  const sorted = [...all].sort((a, b) => b.score - a.score);
  const ranked = sorted
    .filter((r) => !r.is_incidental)
    .slice(0, TIER_META.length * COMBOS_PER_TIER);
  const incidental = sorted
    .filter((r) => r.is_incidental)
    .slice(0, INCIDENTAL_LIMIT);
  const insufficient =
    all.length -
    sorted.filter((r) => !r.is_incidental).length -
    sorted.filter((r) => r.is_incidental).length;
  return { ranked, incidental, insufficient };
}

function comboRankLabel(rank: number): string {
  switch (rank) {
    case 2:
      return "genetic × genetic";
    case 3:
      return "genetic × pattern";
    case 4:
      return "genetic × cosmetic / pattern × pattern";
    case 5:
      return "pattern × cosmetic";
    default:
      return "cosmetic × cosmetic";
  }
}

function ComboCell({
  row,
  index,
  showIncidentalTag,
}: {
  row: Row;
  index: number;
  showIncidentalTag?: boolean;
}) {
  const secondaryToken =
    row.primary_token && row.combo_name.includes(" × ")
      ? row.combo_name
          .split(" × ")
          .find(
            (s) =>
              s.toLowerCase().trim() !==
              (row.primary_token ?? "").toLowerCase().trim(),
          ) ?? null
      : null;
  const primaryDisplay =
    row.primary_token && row.combo_name.includes(" × ")
      ? row.combo_name.split(" × ")[0]
      : null;
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
            {showIncidentalTag ? (
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-500">
                incidental
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
        {primaryDisplay && secondaryToken ? (
          <p className="mb-2 text-[11px] leading-snug text-ink-300">
            <span className="text-ink-100">{primaryDisplay}</span> drives value;{" "}
            <span className="text-ink-100">{secondaryToken.trim()}</span>{" "}
            complements.
          </p>
        ) : null}
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
          <div className="flex justify-between gap-3">
            <dt className="text-ink-400">Combo class</dt>
            <dd className="text-ink-300">{comboRankLabel(row.combo_rank)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[10px] leading-snug text-ink-500">
          Requires ≥ {MIN_SOLD_COUNT} sold listings. Effective price uses
          median sold when available, otherwise median ask × 0.8.
          Score = effective price × sell-through.
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
  const { ranked, incidental } = await fetchTiers(windowDays);

  if (ranked.length === 0 && incidental.length === 0) {
    return (
      <Panel
        title={`Profitability tiers · last ${windowDays} days`}
        subtitle={`Top combos ranked by expected revenue per listing (price × sell-through). Not enough sold data yet — a combo needs ≥ ${MIN_SOLD_COUNT} sold listings in the window to rank.`}
      >
        <p className="text-sm text-ink-400">
          No combos meet the threshold yet.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title={`Profitability tiers · last ${windowDays} days`}
      subtitle="Combos ranked by expected revenue per listing: effective price × sell-through rate (sold ÷ (sold + live)). Primary trait shown first; secondary trait complements it. Anchor combos are from the curated catalog; the rest are auto-discovered top trait pairs."
      right={
        <span className="font-mono text-[11px]">
          {fmtInt(ranked.length)} ranked
          {incidental.length > 0 ? ` · ${fmtInt(incidental.length)} incidental` : ""}
        </span>
      }
    >
      {ranked.length > 0 ? (
        <div className="space-y-3">
          {TIER_META.map((tier) => {
            const start = (tier.rank - 1) * COMBOS_PER_TIER;
            const slice = ranked.slice(start, start + COMBOS_PER_TIER);
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
      ) : null}

      {incidental.length > 0 ? (
        <div className="mt-5 rounded-lg border border-ink-800 bg-ink-900/30 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
                Incidental
              </span>
              <span className="text-[13px] font-medium text-ink-100">
                Trait pairs without a primary driver
              </span>
            </div>
            <span className="font-mono text-[10px] tabular-nums text-ink-500">
              not a value signal
            </span>
          </div>
          <p className="mb-3 text-[11px] leading-snug text-ink-400">
            Both traits are cosmetic descriptors. These pairings surface
            because the tokens co-occur on premium listings whose value
            actually comes from a genetic morph or premium pattern — the
            ranking would over-credit them without this split.
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
            {incidental.map((row, i) => (
              <ComboCell
                key={row.combo_name}
                row={row}
                index={i}
                showIncidentalTag
              />
            ))}
          </div>
        </div>
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
