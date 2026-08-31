"use client";
// Seller concentration panel for the Breeders tab. This is the full-page,
// expanded form of the preview's "market share" visualization: a summary
// row plus a ranked set of gradient share bars.
//
// Honesty is structural here. Seller identity sits on only ~12% of live
// listings (MorphMarket's public API hides the owner on the rest), so every
// share is a share of that attributed pool, and the footer states the
// coverage outright rather than letting the bars read as the whole market.
import type { BreederConcentration } from "@/lib/market/widget-types";
import LivePreviewTag, {
  type LivePreviewStatus,
} from "@/components/market/LivePreviewTag";

export default function BreederConcentrationPanel({
  data,
  status,
  note,
}: {
  data: BreederConcentration;
  status?: LivePreviewStatus;
  note?: string;
}) {
  // Bars are scaled to the leader so the ranking reads at a glance; the exact
  // percentage sits on every row, so the relative scaling never hides a value.
  const leader = data.rows[0]?.sharePct ?? 1;

  return (
    <section className="forest-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
          >
            ▤
          </span>
          <div>
            <h2 className="font-display text-[18px] font-medium tracking-tight text-forest-50">
              Seller concentration
            </h2>
            <p className="mt-0.5 max-w-lg text-xs text-forest-400">
              Which sellers hold the most of the tracked crested catalogue, by
              share of live listings
            </p>
          </div>
        </div>
        {status ? <LivePreviewTag status={status} note={note} /> : null}
      </header>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat
          label="Top 10 share"
          value={`${data.top10Pct.toFixed(1)}%`}
          hint="of attributed listings"
        />
        <Stat
          label="Sellers tracked"
          value={data.sellerCount.toLocaleString()}
          hint="with a live listing"
        />
        <Stat
          label="Listings attributed"
          value={data.totalAttributed.toLocaleString()}
          hint={`${data.coveragePct}% of live catalogue`}
        />
      </div>

      <div className="mt-5 space-y-2.5">
        {data.rows.map((r, i) => {
          const width = Math.max(3, (r.sharePct / leader) * 100);
          return (
            <div key={r.id} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-right font-mono text-[11px] text-forest-500 tabular-nums">
                {i + 1}
              </span>
              <span className="w-40 shrink-0 truncate text-sm text-forest-100">
                {r.name}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-forest-850">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-ready to-ready/50"
                  style={{ width: `${width}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-forest-100">
                {r.sharePct.toFixed(1)}%
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-forest-400">
                {r.listings} live
              </span>
            </div>
          );
        })}
      </div>

      <footer className="mt-4 border-t border-forest-700/70 pt-3 text-[11px] leading-relaxed text-forest-500">
        Share of the {data.totalAttributed.toLocaleString()} live listings
        ({data.coveragePct}% of the catalogue) that carry an identified seller.
        MorphMarket hides the seller on most public listings, so this reads
        concentration among sellers we can name, not the whole market. It
        widens as seller attribution improves.
      </footer>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-forest-700 bg-forest-950/40 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-forest-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-forest-50">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-forest-400">{hint}</div>
    </div>
  );
}
