// Hero histogram for /sold — shows the spread of actual sold prices
// so the page tells a story even before any user-prefs chart is
// enabled in ChartGrid. Pure server component, no dependencies.
//
// Binning: 12 equal buckets between p2 and p98 of the prices, so a
// single outlier doesn't squash the rest of the distribution. The
// outer p2/p98 noise renders as a thin "tails" annotation rather
// than its own bar.
import { fmtInt, fmtUsd } from "@/lib/format";

const BIN_COUNT = 12;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

export default function SoldPriceDistribution({
  prices,
}: {
  prices: (number | null | undefined)[];
}) {
  const cleaned = prices
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (cleaned.length < 5) {
    return (
      <section className="surface p-5">
        <h2 className="font-display text-[18px] font-medium tracking-tight text-ink-50">
          Sold price distribution
        </h2>
        <p className="mt-2 text-sm text-ink-400">
          Not enough sold listings yet to draw a distribution.
        </p>
      </section>
    );
  }

  const lo = percentile(cleaned, 0.02);
  const hi = percentile(cleaned, 0.98);
  const span = hi - lo || 1;
  const binWidth = span / BIN_COUNT;
  const bins: { lo: number; hi: number; count: number }[] = Array.from(
    { length: BIN_COUNT },
    (_, i) => ({
      lo: lo + i * binWidth,
      hi: lo + (i + 1) * binWidth,
      count: 0,
    }),
  );
  let lowTail = 0;
  let highTail = 0;
  for (const v of cleaned) {
    if (v < lo) {
      lowTail++;
      continue;
    }
    if (v >= hi) {
      highTail++;
      continue;
    }
    const idx = Math.min(BIN_COUNT - 1, Math.floor((v - lo) / binWidth));
    bins[idx]!.count++;
  }
  const peak = bins.reduce((a, b) => Math.max(a, b.count), 1);
  const mid = cleaned[Math.floor(cleaned.length / 2)] ?? 0;

  return (
    <section className="surface p-5">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[20px] font-medium tracking-tight text-ink-50">
            Sold price distribution
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            {fmtInt(cleaned.length)} sold listings · median {fmtUsd(mid)} ·
            bins between {fmtUsd(lo)} and {fmtUsd(hi)}.
          </p>
        </div>
      </header>

      <div className="flex h-44 items-end gap-1.5">
        {bins.map((b, i) => {
          const h = (b.count / peak) * 100;
          const isMidBin = mid >= b.lo && mid < b.hi;
          return (
            <div
              key={i}
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${fmtUsd(b.lo)}–${fmtUsd(b.hi)} · ${fmtInt(b.count)} sold`}
            >
              <div
                className="w-full rounded-t-md transition-all"
                style={{
                  height: `${Math.max(2, h)}%`,
                  background: isMidBin
                    ? "linear-gradient(180deg, #2dbf95, #0e9a73)"
                    : "linear-gradient(180deg, #1f7a5e, #0c5841)",
                }}
              />
            </div>
          );
        })}
      </div>

      <footer className="mt-3 flex items-baseline justify-between gap-3 font-mono text-[10px] tabular-nums text-ink-500">
        <span>{fmtUsd(lo)}</span>
        {lowTail + highTail > 0 ? (
          <span className="text-ink-400">
            {lowTail > 0 ? `${lowTail} below` : null}
            {lowTail > 0 && highTail > 0 ? " · " : null}
            {highTail > 0 ? `${highTail} above` : null}
          </span>
        ) : null}
        <span>{fmtUsd(hi)}</span>
      </footer>
    </section>
  );
}
