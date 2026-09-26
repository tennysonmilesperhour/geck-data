// Every crested gecko morph, grouped the way breeders think about them:
// genes with predictable inheritance first, then line-bred patterns and
// colors. Each morph is priced against the typical crested gecko ("2.1×")
// so any two can be compared at a glance, the way an index compares
// stocks against the market.
import Link from "next/link";
import { getBaseline, getMorphs, type Morph } from "@/lib/simple/data";
import { GROUPS, traitInfo } from "@/lib/simple/genetics";
import { Empty, PageIntro, PriceRangeBar, niceMax } from "@/components/simple/ui";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 1800;

export const metadata = {
  title: "Crested gecko morphs and prices - Geck Inspect",
  description:
    "Every crested gecko morph with its typical price, how it is inherited, and how it compares to a typical crested gecko.",
};

export default async function MorphsPage() {
  const [morphs, baseline] = await Promise.all([getMorphs(), getBaseline()]);
  const scaleMax = niceMax(Math.max(...morphs.map((m) => m.askHigh ?? 0), 400));

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <PageIntro title="Morphs">
        Every crested gecko trait we track, grouped by how it is passed on. Prices are
        compared with a typical crested gecko, listed at{" "}
        <span className="font-medium text-ink-100">{fmtUsd(baseline.p50)}</span>.
      </PageIntro>

      {morphs.length === 0 ? (
        <Empty>Morph prices could not load right now. Try again in a minute.</Empty>
      ) : (
        GROUPS.map((g) => {
          const list = morphs
            .filter((m) => traitInfo(m.trait).group === g.id && m.askMid != null)
            .sort((a, b) => (b.askMid ?? 0) - (a.askMid ?? 0));
          if (!list.length) return null;
          return (
            <section key={g.id} className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-ink-50">{g.title}</h2>
                <p className="mt-1 text-sm text-ink-400">{g.blurb}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((m) => (
                  <MorphCard key={m.slug} m={m} baseline={baseline.p50} scaleMax={scaleMax} />
                ))}
              </div>
            </section>
          );
        })
      )}

      <p className="text-sm text-ink-500">
        Sorted by typical asking price within each group. The bar shows the middle half
        of current asking prices on a shared scale. Genetics follow the{" "}
        <a
          href="https://geckinspect.com/GeneticsGuide"
          className="text-ink-300 underline hover:text-ink-100"
        >
          Geck Inspect genetics guide
        </a>
        .
      </p>
    </div>
  );
}

function MorphCard({
  m,
  baseline,
  scaleMax,
}: {
  m: Morph;
  baseline: number | null;
  scaleMax: number;
}) {
  const info = traitInfo(m.trait);
  const ratio = baseline && m.askMid ? m.askMid / baseline : null;
  return (
    <Link
      href={`/morphs/${m.slug}`}
      className="flex flex-col gap-3 rounded-xl border border-ink-700 bg-ink-850 p-4 transition hover:border-ink-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-ink-50">{m.trait}</div>
          <div className="text-xs text-ink-400">
            {info.kind}
            {info.confidence === "emerging" ? ", emerging" : ""}
          </div>
        </div>
        {ratio ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
              ratio >= 1.15
                ? "bg-claude/15 text-claude-glow"
                : ratio <= 0.85
                  ? "bg-ink-700 text-ink-300"
                  : "bg-ink-800 text-ink-300"
            }`}
            title="Compared with a typical crested gecko"
          >
            {ratio.toFixed(1)}×
          </span>
        ) : null}
      </div>
      <div>
        <div className="text-2xl font-semibold tabular-nums text-ink-50">{fmtUsd(m.askMid)}</div>
        <div className="text-xs text-ink-400">
          most {fmtUsd(m.askLow)} to {fmtUsd(m.askHigh)}, {fmtInt(m.forSale)} listed
        </div>
      </div>
      <PriceRangeBar
        band={{ p10: null, p25: m.askLow, p50: m.askMid, p75: m.askHigh, p90: null }}
        scaleMax={scaleMax}
      />
    </Link>
  );
}
