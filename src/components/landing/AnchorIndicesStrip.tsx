// Four-up anchor sub-index tiles for Pulse. Same shape as the
// MarketSubIndices band on /market Overview but as a server
// component that hits Supabase directly, so the home page can be
// SSR'd without dragging the /market client widget tree across.
//
// Pulls from v_market_sub_index(180) (migration 0035) and rebases
// each anchor's series client-free. Empty-state copy points the
// reader at /indices for full context.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import MiniSparkline from "@/components/charts/MiniSparkline";
import {
  ANCHOR_ORDER,
  paletteFor,
  type AnchorKey,
} from "@/lib/market/anchors";

export default async function AnchorIndicesStrip() {
  const supabase = createClient();
  const { data } = await supabase.rpc("v_market_sub_index", {
    window_days: 180,
  });

  type Row = {
    anchor: string;
    week_start: string;
    value: number | string | null;
    n: number | string;
  };
  const rows = (data ?? []) as Row[];

  type Tile = {
    key: AnchorKey;
    series: number[];
    current: number;
    delta: number;
  };
  const byAnchor = new Map<AnchorKey, Tile>();
  for (const r of rows) {
    if (r.value == null) continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    const key = r.anchor as AnchorKey;
    if (!ANCHOR_ORDER.includes(key)) continue;
    const cur = byAnchor.get(key) ?? { key, series: [], current: 0, delta: 0 };
    cur.series.push(v);
    cur.current = v;
    byAnchor.set(key, cur);
  }
  for (const t of byAnchor.values()) {
    if (t.series.length < 2) continue;
    const start = t.series[0]!;
    t.delta = start === 0 ? 0 : ((t.current - start) / start) * 100;
  }
  const tiles = ANCHOR_ORDER.map((k) => byAnchor.get(k)).filter(
    (t): t is Tile => Boolean(t && t.series.length >= 2),
  );

  if (tiles.length === 0) {
    return (
      <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-panel">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
              Anchor families
            </div>
            <h2 className="mt-1 font-display text-[20px] font-medium tracking-tight text-ink-50">
              Four signature morphs to watch
            </h2>
          </div>
          <Link
            href="/indices"
            className="text-xs text-ink-400 hover:text-ink-100"
          >
            All indices →
          </Link>
        </div>
        <p className="mt-3 text-sm text-ink-400">
          Anchor sub-indices need at least two weeks of observations per
          family before they render. The substrate is ready; data is
          accumulating. Check back tomorrow or visit{" "}
          <Link href="/indices" className="underline">/indices</Link> for
          per-combo deltas.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-panel">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
            Anchor families
          </div>
          <h2 className="mt-1 font-display text-[20px] font-medium tracking-tight text-ink-50">
            Four signature morphs to watch
          </h2>
          <p className="mt-1.5 text-xs text-ink-400">
            Median observed market price per family, rebased to 1000 at
            the start of the window. Click any tile for the per-trait
            page.
          </p>
        </div>
        <Link
          href="/indices"
          className="text-xs text-ink-400 hover:text-ink-100"
        >
          All indices →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => {
          const palette = paletteFor(t.key)!;
          const positive = t.delta >= 0;
          const deltaCls = positive ? "text-ready" : "text-danger";
          const slug = t.key.toLowerCase().replace(/\s+/g, "-");
          return (
            <Link
              key={t.key}
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
              <div className="relative flex items-baseline justify-between">
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: palette.text }}
                >
                  {t.key}
                </span>
                <span className={`font-mono text-[11px] tabular-nums ${deltaCls}`}>
                  {positive ? "▲" : "▼"} {Math.abs(t.delta).toFixed(1)}%
                </span>
              </div>
              <div className="relative mt-1 font-display text-[22px] font-medium tabular-nums text-ink-50">
                {Math.round(t.current).toLocaleString()}
              </div>
              <div className="relative -mx-1 mt-1">
                <MiniSparkline
                  values={t.series}
                  width={200}
                  height={48}
                  fill
                  color={palette.hex}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
