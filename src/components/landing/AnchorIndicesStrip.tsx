// Top-of-Pulse strip: the morph families that drive the market right
// now, ranked by listing count. Data-driven (no curated list); every
// observed trait with >= 3 listings competes for the top slots.
//
// Reads from v_observed_traits (migration 0037). Pulls 8 by default;
// each tile shows current median price + listing count + a 90d
// sparkline if we have one. Links to /trait/[slug] for the deep dive.
//
// The previous four-tile band hardcoded Lilly White / Axanthic /
// Harlequin / Cappuccino. That was confusing because nothing
// explained why those four; this version explains itself by being
// ranked.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { colorForTrait } from "@/lib/market/anchors";

const TOP_N = 8;

type ObservedTraitRow = {
  trait: string;
  n: number | string;
  median_price: number | string | null;
};

export default async function AnchorIndicesStrip() {
  const supabase = createClient();

  const { data: traits } = await supabase
    .from("v_observed_traits")
    .select("trait, n, median_price")
    .order("n", { ascending: false })
    .limit(TOP_N);

  const top = (traits ?? []) as ObservedTraitRow[];

  if (top.length === 0) {
    return (
      <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-panel">
        <h2 className="font-display text-[20px] font-medium text-ink-50">
          Anchor morphs
        </h2>
        <p className="mt-2 text-sm text-ink-400">
          No trait observations yet. Visit{" "}
          <Link href="/indices" className="underline">/indices</Link> once data
          accumulates.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-panel">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
            Anchor morphs
          </div>
          <h2 className="mt-1 font-display text-[20px] font-medium tracking-tight text-ink-50">
            The eight families driving the market
          </h2>
          <p className="mt-1.5 text-xs text-ink-400">
            Ranked by listing count. Auto-discovered from{" "}
            <code className="rounded bg-ink-900 px-1 py-0.5 text-[10px]">cached_traits</code>;
            nothing is hand-picked.
          </p>
        </div>
        <Link href="/indices" className="text-xs text-ink-400 hover:text-ink-100">
          All morphs →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {top.map((t) => {
          const palette = colorForTrait(t.trait);
          const slug = t.trait.toLowerCase().replace(/\s+/g, "-");
          const n = Number(t.n ?? 0);
          const median = Number(t.median_price ?? 0);
          return (
            <Link
              key={t.trait}
              href={`/trait/${slug}`}
              className="relative overflow-hidden rounded-lg border border-ink-700 bg-ink-800 p-3 transition hover:border-ink-600"
              style={{
                backgroundImage: `linear-gradient(135deg, ${palette.soft} 0%, transparent 70%)`,
              }}
            >
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 w-1"
                style={{ background: palette.hex, opacity: 0.9 }}
              />
              <div
                className="relative font-mono text-[10px] uppercase tracking-[0.14em] truncate"
                style={{ color: palette.text }}
                title={t.trait}
              >
                {t.trait}
              </div>
              <div className="relative mt-1 font-display text-[20px] font-medium tabular-nums text-ink-50">
                {median ? `$${median.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
              </div>
              <div className="relative mt-0.5 font-mono text-[10px] text-ink-500">
                {n.toLocaleString()} listings · median
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
