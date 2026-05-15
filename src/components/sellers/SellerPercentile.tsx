// Where this seller sits on the market median-price distribution.
// The framing is the same one Zillow uses for a home's price band
// against the neighborhood: a single percentile read + visual cue
// for "premium / median / value" — not a number a beginner has to
// translate.
import { Panel } from "@/components/ui/Panel";
import { fmtInt, fmtUsd } from "@/lib/format";

export default function SellerPercentile({
  sellerMedian,
  marketMedians,
}: {
  sellerMedian: number;
  marketMedians: ReadonlyArray<number>;
}) {
  // Need a meaningful denominator. Below ~10 priced sellers a
  // percentile reads as noise, so don't bother rendering it.
  if (marketMedians.length < 10 || sellerMedian <= 0) {
    return (
      <Panel
        title="Pricing percentile"
        subtitle="Not enough comparable sellers with priced listings to anchor a percentile yet."
      >
        <p className="py-2 text-sm text-ink-400">
          Need at least 10 sellers with priced listings.
        </p>
      </Panel>
    );
  }

  const sorted = [...marketMedians].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < sellerMedian).length;
  const pct = Math.round((below / sorted.length) * 100);
  const marketMedian = sorted[Math.floor(sorted.length / 2)]!;
  const p25 = sorted[Math.floor(sorted.length * 0.25)]!;
  const p75 = sorted[Math.floor(sorted.length * 0.75)]!;

  const tier =
    pct >= 75 ? { label: "Premium pricing", tone: "warn" as const }
    : pct >= 40 ? { label: "Near market median", tone: "info" as const }
    : { label: "Value pricing", tone: "positive" as const };

  const toneColor =
    tier.tone === "warn"
      ? "#cd6e3c"
      : tier.tone === "positive"
        ? "#7bbf83"
        : "#7ab1d1";

  // Map prices onto the bar's 0–100 range, clamped to the visible
  // window (p10 → p90) so the tick never floats far off the chart
  // when an outlier seller dominates the domain.
  const lo = sorted[Math.floor(sorted.length * 0.1)]!;
  const hi = sorted[Math.floor(sorted.length * 0.9)]!;
  const span = Math.max(1, hi - lo);
  const placeOnBar = (price: number): number => {
    const clamped = Math.max(lo, Math.min(hi, price));
    return Math.round(((clamped - lo) / span) * 100);
  };
  const sellerX = placeOnBar(sellerMedian);
  const medianX = placeOnBar(marketMedian);
  const p25X = placeOnBar(p25);
  const p75X = placeOnBar(p75);

  return (
    <Panel
      title="Pricing percentile"
      subtitle={`Where this seller's median listing sits against ${fmtInt(sorted.length)} other crested-gecko sellers with priced listings. The 25th–75th band is the visual middle of the market.`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-display text-[26px] font-medium tabular-nums text-ink-50">
            {pct}
            <span className="ml-0.5 text-base text-ink-400">th %ile</span>
          </div>
          <div
            className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.12em]"
            style={{ color: toneColor }}
          >
            {tier.label}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-[0.12em] text-ink-500">
            Seller median
          </div>
          <div className="font-mono text-base tabular-nums text-ink-100">
            {fmtUsd(sellerMedian)}
          </div>
        </div>
      </div>

      <div className="relative mt-4 h-6">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded bg-ink-700/70" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded bg-ink-650"
          style={{
            left: `${p25X}%`,
            width: `${Math.max(2, p75X - p25X)}%`,
          }}
          title={`Market interquartile range: ${fmtUsd(p25)} → ${fmtUsd(p75)}`}
        />
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-ink-300"
          style={{ left: `${medianX}%` }}
          title={`Market median: ${fmtUsd(marketMedian)}`}
        />
        <div
          className="absolute top-1/2 grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-ink-900"
          style={{ left: `${sellerX}%`, background: toneColor }}
          title={`This seller: ${fmtUsd(sellerMedian)} (${pct}th percentile)`}
        />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-ink-500">
        <span>{fmtUsd(lo)}</span>
        <span>{fmtUsd(marketMedian)} · market median</span>
        <span>{fmtUsd(hi)}</span>
      </div>
    </Panel>
  );
}
