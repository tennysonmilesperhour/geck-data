// Trait activity — per-trait daily sparkline + slope + total count
// over the last 14 days. The chart primitive is now the shared
// MiniSparkline so this file just owns the data fetch + panel chrome
// + slope tag pill.
//
// All computed off listings.first_seen_at — no synthetic data, no
// 100% deltas when the prior window is empty.
import { Panel } from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { fmtInt } from "@/lib/format";
import MiniSparkline, {
  type SlopeKind,
  classifySlope,
} from "@/components/charts/MiniSparkline";
import { parseTraitList } from "@/lib/traits";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14;

type Row = {
  norm_traits: string | null;
  cached_traits: string | null;
  first_seen_at: string | null;
};

type TraitSeries = {
  trait: string;
  daily: number[];
  total: number;
  earlyCount: number;
  lateCount: number;
};

function dayIndex(iso: string, windowStart: number): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const idx = Math.floor((t - windowStart) / DAY_MS);
  return idx >= 0 && idx < WINDOW_DAYS ? idx : null;
}

function traitTokens(r: Row): string[] {
  // parseTraitList drops key/value segments like "Diet: Meal Replacement"
  // and "Proven breeder: No" that the extension concatenates into
  // cached_traits/norm_traits. See src/lib/traits.ts.
  return parseTraitList(r);
}

async function fetchSeries(): Promise<TraitSeries[]> {
  const supabase = createClient();
  const sinceMs = Date.now() - WINDOW_DAYS * DAY_MS;
  const since = new Date(sinceMs).toISOString();

  const { data } = await supabase
    .from("market_listings")
    .select("norm_traits, cached_traits, first_seen_at")
    .gte("first_seen_at", since)
    .limit(20000);

  const rows = (data ?? []) as Row[];
  const byTrait = new Map<string, number[]>();

  for (const r of rows) {
    if (!r.first_seen_at) continue;
    const idx = dayIndex(r.first_seen_at, sinceMs);
    if (idx === null) continue;
    for (const t of traitTokens(r)) {
      const arr = byTrait.get(t) ?? Array.from({ length: WINDOW_DAYS }, () => 0);
      arr[idx]! += 1;
      byTrait.set(t, arr);
    }
  }

  const HALF = Math.floor(WINDOW_DAYS / 2);
  const series: TraitSeries[] = [];
  for (const [trait, daily] of byTrait) {
    const total = daily.reduce((a, b) => a + b, 0);
    if (total < 3) continue; // noise floor
    const earlyCount = daily.slice(0, HALF).reduce((a, b) => a + b, 0);
    const lateCount = daily.slice(HALF).reduce((a, b) => a + b, 0);
    series.push({ trait, daily, total, earlyCount, lateCount });
  }
  series.sort((a, b) => b.total - a.total);
  return series.slice(0, 24);
}

const SLOPE_TAG: Record<SlopeKind, { label: string; cls: string; glyph: string }> = {
  rising: {
    label: "rising",
    cls: "border-ready/40 bg-ready/10 text-ready",
    glyph: "↑",
  },
  cooling: {
    label: "cooling",
    cls: "border-danger/40 bg-danger/10 text-danger",
    glyph: "↓",
  },
  new: {
    label: "new",
    cls: "border-info/40 bg-info/10 text-info",
    glyph: "✦",
  },
  flat: {
    label: "flat",
    cls: "border-ink-700 bg-ink-850 text-ink-400",
    glyph: "−",
  },
};

function SlopeTag({ kind }: { kind: SlopeKind }) {
  const m = SLOPE_TAG[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] ${m.cls}`}
    >
      <span aria-hidden>{m.glyph}</span>
      {m.label}
    </span>
  );
}

export default async function TraitMomentumPanels() {
  const series = await fetchSeries();
  if (series.length === 0) {
    return (
      <Panel
        title="Trait activity · last 14 days"
        subtitle="Daily appearances of each trait in new listings. Not enough data yet — the catalog is still spinning up."
      >
        <p className="text-sm text-ink-400">
          No traits have been seen at least three times in the last 14 days.
          As the daily scrape continues, this panel will fill in.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Trait activity · last 14 days"
      subtitle="Each row is one trait. The sparkline is its daily appearance count over the window; the badge compares the late 7 days to the early 7 days. ↑ rising, ↓ cooling, ✦ new this week, − flat."
    >
      <ul className="divide-y divide-ink-700/60">
        {series.map((s) => {
          const kind = classifySlope(s.earlyCount, s.lateCount);
          return (
            <li
              key={s.trait}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 py-2.5 font-sans text-sm"
            >
              <span className="truncate capitalize text-ink-100">
                {s.trait}
              </span>
              <MiniSparkline values={s.daily} width={96} height={22} />
              <span className="w-16 text-right font-mono text-[12px] tabular-nums text-ink-300">
                {fmtInt(s.total)}
              </span>
              <SlopeTag kind={kind} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function TraitMomentumSkeleton() {
  return (
    <div className="surface p-5" aria-label="Loading trait activity">
      <div className="mb-3 h-5 w-48 animate-pulse rounded bg-ink-800" />
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, j) => (
          <div key={j} className="h-7 animate-pulse rounded bg-ink-800/70" />
        ))}
      </div>
    </div>
  );
}
