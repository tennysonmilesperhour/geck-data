// Histogram of how long this seller's recent listings take to sell,
// vs the same distribution for the market as a whole. Bars use the
// seller's tone (moss), with the market median called out as a
// dashed vertical reference line on the same axis.
//
// Buckets are intentional ranges that line up with how breeders think
// about "moved fast" vs "lingered": 0-7 / 8-14 / 15-30 / 31-60 /
// 61-120 / 120+ days.
import { Panel } from "@/components/ui/Panel";
import { fmtInt } from "@/lib/format";
import { chartTheme } from "@/components/charts/theme";

const BUCKETS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: "0–7d", min: 0, max: 7 },
  { label: "8–14d", min: 8, max: 14 },
  { label: "15–30d", min: 15, max: 30 },
  { label: "31–60d", min: 31, max: 60 },
  { label: "61–120d", min: 61, max: 120 },
  { label: "120d+", min: 121, max: Infinity },
];

function bucketize(days: ReadonlyArray<number>): number[] {
  const out = new Array(BUCKETS.length).fill(0);
  for (const d of days) {
    if (typeof d !== "number" || !Number.isFinite(d) || d < 0) continue;
    const idx = BUCKETS.findIndex((b) => d >= b.min && d <= b.max);
    if (idx >= 0) out[idx]++;
  }
  return out;
}

function median(arr: ReadonlyArray<number>): number | null {
  const clean = arr.filter((d) => typeof d === "number" && Number.isFinite(d));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export default function TimeOnMarketHistogram({
  sellerDays,
  marketDays,
}: {
  sellerDays: ReadonlyArray<number>;
  marketDays: ReadonlyArray<number>;
}) {
  if (sellerDays.length < 3) {
    return (
      <Panel
        title="Time-on-market distribution"
        subtitle="How long this seller's listings take to sell, compared to the market. Need at least 3 sold observations from this seller before the shape is meaningful."
      >
        <p className="py-2 text-sm text-ink-400">
          Only {fmtInt(sellerDays.length)} sold listings tracked for this seller
          so far — keep checking back as the extension captures more.
        </p>
      </Panel>
    );
  }

  const sellerBuckets = bucketize(sellerDays);
  const marketBuckets = bucketize(marketDays);
  const sellerTotal = sellerBuckets.reduce((a, b) => a + b, 0);
  const marketTotal = marketBuckets.reduce((a, b) => a + b, 0);

  // Normalize to percentages so the seller's smaller sample isn't
  // visually flattened next to the market's larger one.
  const sellerPct = sellerBuckets.map((c) =>
    sellerTotal > 0 ? (c / sellerTotal) * 100 : 0,
  );
  const marketPct = marketBuckets.map((c) =>
    marketTotal > 0 ? (c / marketTotal) * 100 : 0,
  );

  const max = Math.max(1, ...sellerPct, ...marketPct);
  const sellerMedian = median(sellerDays);
  const marketMedian = median(marketDays);

  return (
    <Panel
      title="Time-on-market distribution"
      subtitle={`How long this seller's ${fmtInt(sellerTotal)} tracked sold listings took to move, vs ${fmtInt(marketTotal)} sold listings across the market. Bar height = share of listings in that bucket.`}
    >
      <div className="grid grid-cols-6 gap-3">
        {BUCKETS.map((b, i) => {
          const sellerH = Math.round((sellerPct[i]! / max) * 100);
          const marketH = Math.round((marketPct[i]! / max) * 100);
          return (
            <div key={b.label} className="flex flex-col items-center">
              <div className="flex h-28 w-full items-end justify-center gap-1">
                <div
                  className="w-3 rounded-t bg-ink-650"
                  style={{ height: `${marketH}%` }}
                  title={`Market: ${marketPct[i]!.toFixed(0)}%`}
                />
                <div
                  className="w-3 rounded-t"
                  style={{
                    height: `${sellerH}%`,
                    background: chartTheme.primary,
                  }}
                  title={`This seller: ${sellerPct[i]!.toFixed(0)}%`}
                />
              </div>
              <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                {b.label}
              </div>
              <div className="font-mono text-[10px] tabular-nums text-ink-500">
                {sellerBuckets[i]!} / {marketBuckets[i]!}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-700/60 pt-3 text-xs">
        <div className="flex items-center gap-3 text-ink-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-ink-650" />
            Market
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: chartTheme.primary }}
            />
            This seller
          </span>
        </div>
        <div className="font-mono text-[11px] tabular-nums text-ink-300">
          {sellerMedian != null ? (
            <>
              Median {Math.round(sellerMedian)}d
              {marketMedian != null ? (
                <span className="ml-1 text-ink-500">
                  · market {Math.round(marketMedian)}d
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
