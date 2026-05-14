// What's Hot — top combos ranked by current activity (live + sold count).
// Visual rank bars proportional to total volume so the eye can scan the
// distribution at a glance. Each row deep-links into the Combos tab on
// /market preloaded with that combo selected.
import Link from "next/link";
import { fmtUsd, fmtInt } from "@/lib/format";
import type { ComboSnapshot } from "@/lib/landing/snapshot";

type Props = {
  combos: ComboSnapshot[];
  limit?: number;
};

export default function WhatsHotPanel({ combos, limit = 8 }: Props) {
  const rows = combos.slice(0, limit);
  const maxVolume = Math.max(
    ...rows.map((c) => c.live_count + c.sold_count),
    1,
  );

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-panel">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
            Pulse
          </div>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-ink-50">
            What&apos;s hot
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            Top combos by current activity — live listings plus recent sales.
          </p>
        </div>
        <Link
          href="/market"
          className="text-xs text-ink-400 transition hover:text-ink-100"
        >
          All combos →
        </Link>
      </header>

      <ol className="space-y-2">
        {rows.length === 0 ? (
          <li className="rounded-md border border-ink-700/60 bg-ink-900/40 px-3 py-4 text-sm text-ink-400">
            No combo activity in the current window.
          </li>
        ) : (
          rows.map((combo, idx) => {
            const total = combo.live_count + combo.sold_count;
            const widthPct = Math.max(4, (total / maxVolume) * 100);
            return (
              <li key={combo.combo_name}>
                <Link
                  href={`/market?combo=${encodeURIComponent(combo.combo_name)}`}
                  className="group relative block overflow-hidden rounded-md border border-ink-700/60 bg-ink-900/40 px-3 py-2.5 transition hover:border-emerald-500/40 hover:bg-ink-800/60"
                >
                  <div
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/[0.06] to-emerald-500/0 transition-all"
                    style={{ width: `${widthPct}%` }}
                  />
                  <div className="relative flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-5 font-mono text-[10px] text-ink-500">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="font-medium text-ink-100">
                        {combo.combo_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums text-ink-300">
                      <span>
                        <span className="text-ink-500">live </span>
                        {fmtInt(combo.live_count)}
                      </span>
                      <span className="hidden md:inline">
                        <span className="text-ink-500">sold </span>
                        {fmtInt(combo.sold_count)}
                      </span>
                      <span className="text-ink-100">
                        {combo.median_ask ? fmtUsd(combo.median_ask) : "—"}
                      </span>
                      <ConfidenceBadge score={combo.confidence_score} />
                    </div>
                  </div>
                </Link>
              </li>
            );
          })
        )}
      </ol>
    </section>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const tier =
    score >= 80
      ? "high"
      : score >= 50
        ? "med"
        : score >= 20
          ? "low"
          : "thin";
  const cls = {
    high: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    med: "bg-sky-500/10 text-sky-300 border-sky-500/30",
    low: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    thin: "bg-ink-700/30 text-ink-400 border-ink-700",
  }[tier];
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-1.5 font-mono text-[9px] uppercase ${cls}`}
    >
      {score}
    </span>
  );
}
