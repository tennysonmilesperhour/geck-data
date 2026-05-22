// Compact "where are the breeders?" panel. Counts seller_location
// occurrences, takes the top N, renders proportional bars. Server
// component — pure data in, JSX out, no client hydration needed.
import { fmtInt } from "@/lib/format";

type SellerLocationRow = { seller_location: string | null };

export default function LocationDistribution({
  rows,
  topN = 8,
}: {
  rows: SellerLocationRow[];
  topN?: number;
}) {
  // Normalise: strip leading/trailing whitespace, fold case for grouping.
  // Many sellers leave location blank; those collapse into "Unspecified".
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = (r.seller_location ?? "").trim();
    const key = raw.length === 0 ? "Unspecified" : raw;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const allKnown = Array.from(counts.entries()).filter(
    ([k]) => k !== "Unspecified",
  );
  const totalKnown = allKnown.reduce((a, [, c]) => a + c, 0);
  const ranked = allKnown
    .slice()
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  const unspec = counts.get("Unspecified") ?? 0;
  if (ranked.length === 0) {
    return null;
  }
  const maxCount = ranked[0]![1];
  const topShare = ranked.reduce((a, [, c]) => a + c, 0);
  const longTail = totalKnown - topShare;
  const longTailCities = allKnown.length - ranked.length;

  return (
    <section className="surface p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="font-display text-[18px] font-medium tracking-tight text-ink-50">
            Where they ship from
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-400">
            {fmtInt(totalKnown)} sellers across {fmtInt(allKnown.length)}{" "}
            location strings
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-500">
          top {ranked.length}
        </span>
      </header>

      <ul className="space-y-2.5">
        {ranked.map(([location, count]) => {
          const widthPct = (count / maxCount) * 100;
          const sharePct = totalKnown > 0 ? (count / totalKnown) * 100 : 0;
          return (
            <li key={location} className="group">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-sm text-ink-100">{location}</span>
                <span className="flex items-baseline gap-2 font-mono text-[11px] tabular-nums">
                  <span className="text-ink-500">{sharePct.toFixed(1)}%</span>
                  <span className="text-ink-200">{fmtInt(count)}</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-claude-soft to-claude-glow transition-all"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="mt-4 space-y-1 border-t border-ink-700/60 pt-3 text-[11px] text-ink-500">
        {longTail > 0 ? (
          <div>
            {fmtInt(longTail)} more sellers across {fmtInt(longTailCities)}{" "}
            other cities (long tail).
          </div>
        ) : null}
        {unspec > 0 ? (
          <div>
            {fmtInt(unspec)} {unspec === 1 ? "seller has" : "sellers have"} no
            location on file.
          </div>
        ) : null}
      </footer>
    </section>
  );
}
