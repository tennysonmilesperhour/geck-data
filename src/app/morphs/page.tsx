// Every crested gecko morph we track, with what it lists and sells for.
// One row per morph, one shared price axis so rows can be compared at a
// glance. Each row opens the morph's own page.
import Link from "next/link";
import { getMorphs } from "@/lib/simple/data";
import {
  Empty,
  PageIntro,
  PriceRangeBar,
  PriceScale,
  niceMax,
} from "@/components/simple/ui";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 1800;

export const metadata = {
  title: "Crested gecko morphs and prices - Geck Inspect",
  description:
    "Typical asking and sold prices for every crested gecko morph listed on MorphMarket.",
};

export default async function MorphsPage() {
  const morphs = await getMorphs();
  const scaleMax = niceMax(Math.max(...morphs.map((m) => m.askHigh ?? 0), 400));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageIntro title="Morphs">
        What each crested gecko morph is listed at and what it has sold for. Pick a
        morph to see listings, prices and common pairings.
      </PageIntro>

      {morphs.length === 0 ? (
        <Empty>Morph prices could not load right now. Try again in a minute.</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <div className="hidden grid-cols-[1.3fr_0.6fr_2fr_0.7fr] gap-4 border-b border-ink-700 bg-ink-900 px-5 py-3 text-sm text-ink-400 md:grid">
            <div>Morph</div>
            <div className="text-right">Listed</div>
            <div>
              Asking price range
              <PriceScale max={scaleMax} />
            </div>
            <div className="text-right">Typical sold</div>
          </div>
          <ul className="divide-y divide-ink-700 bg-ink-850">
            {morphs.map((m) => (
              <li key={m.slug}>
                <Link
                  href={`/morphs/${m.slug}`}
                  className="grid grid-cols-2 items-center gap-x-4 gap-y-2 px-5 py-4 transition hover:bg-ink-800 md:grid-cols-[1.3fr_0.6fr_2fr_0.7fr]"
                >
                  <div className="font-medium text-ink-50">{m.trait}</div>
                  <div className="text-right text-sm tabular-nums text-ink-300 md:text-base">
                    {fmtInt(m.forSale)}
                    <span className="md:hidden"> listed</span>
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <div className="mb-1 text-sm tabular-nums text-ink-200">
                      {m.askMid != null
                        ? `${fmtUsd(m.askLow)} to ${fmtUsd(m.askHigh)}, middle ${fmtUsd(m.askMid)}`
                        : "No USD listings"}
                    </div>
                    {m.askMid != null ? (
                      <PriceRangeBar
                        band={{ p10: null, p25: m.askLow, p50: m.askMid, p75: m.askHigh, p90: null }}
                        scaleMax={scaleMax}
                      />
                    ) : null}
                  </div>
                  <div className="col-span-2 text-sm tabular-nums text-ink-300 md:col-span-1 md:text-right md:text-base">
                    <span className="md:hidden">Typical sold </span>
                    {m.sold >= 3 ? fmtUsd(m.soldMid) : "Too few sales"}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-ink-500">
        Asking range covers the middle half of current listings. Sold prices come from
        listings that came down in spring 2026 and use their last asking price.
      </p>
    </div>
  );
}
