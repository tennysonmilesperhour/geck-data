// Trait activity — per-trait sparkline + slope + total count over the
// window length the parent /trends page is showing (90d default, 180d
// when toggled). Weekly buckets for the sparkline so 13–26 points
// render legibly instead of a noisy 90/180-day daily stream.
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
const WEEK_MS = 7 * DAY_MS;

type Row = {
  norm_traits: string | null;
  cached_traits: string | null;
  first_seen_at: string | null;
};

type TraitSeries = {
  trait: string;
  weekly: number[];
  total: number;
  earlyCount: number;
  lateCount: number;
};

function weekIndex(iso: string, windowStart: number, weeks: number): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const idx = Math.floor((t - windowStart) / WEEK_MS);
  return idx >= 0 && idx < weeks ? idx : null;
}

async function fetchSeries(windowDays: number): Promise<TraitSeries[]> {
  const supabase = createClient();
  const weeks = Math.max(2, Math.ceil(windowDays / 7));
  const sinceMs = Date.now() - weeks * WEEK_MS;
  const since = new Date(sinceMs).toISOString();

  const { data } = await supabase
    .from("market_listings")
    .select("norm_traits, cached_traits, first_seen_at")
    .gte("first_seen_at", since)
    .limit(30000);

  const rows = (data ?? []) as Row[];
  const byTrait = new Map<string, number[]>();

  for (const r of rows) {
    if (!r.first_seen_at) continue;
    const idx = weekIndex(r.first_seen_at, sinceMs, weeks);
    if (idx === null) continue;
    for (const t of parseTraitList(r)) {
      const arr = byTrait.get(t) ?? Array.from({ length: weeks }, () => 0);
      arr[idx]! += 1;
      byTrait.set(t, arr);
    }
  }

  // Noise floor scales with window so the panel stays readable at both
  // 90d and 180d. Roughly: require at least one appearance per ~2 weeks
  // on average for a trait to make the list.
  const NOISE_FLOOR = Math.max(3, Math.floor(weeks / 2));
  const HALF = Math.floor(weeks / 2);
  const out: TraitSeries[] = [];
  for (const [trait, weekly] of byTrait) {
    const total = weekly.reduce((a, b) => a + b, 0);
    if (total < NOISE_FLOOR) continue;
    const earlyCount = weekly.slice(0, HALF).reduce((a, b) => a + b, 0);
    const lateCount = weekly.slice(HALF).reduce((a, b) => a + b, 0);
    out.push({ trait, weekly, total, earlyCount, lateCount });
  }
  out.sort((a, b) => b.total - a.total);
  return out.slice(0, 24);
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

export default async function TraitMomentumPanels({
  windowDays = 90,
}: {
  windowDays?: number;
}) {
  const series = await fetchSeries(windowDays);
  const halfDays = Math.floor(windowDays / 2);
  if (series.length === 0) {
    return (
      <Panel
        title={`Trait activity · last ${windowDays} days`}
        subtitle="Weekly appearances of each trait in new listings. Not enough data yet — the catalog is still spinning up."
      >
        <p className="text-sm text-ink-400">
          No traits have been seen often enough in the last {windowDays} days
          to clear the noise floor. As the daily scrape continues, this panel
          will fill in.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title={`Trait activity · last ${windowDays} days`}
      subtitle={`Each row is one trait. The sparkline is its weekly appearance count over the window; the badge compares the late ${halfDays} days to the early ${halfDays}. ↑ rising, ↓ cooling, ✦ new this period, − flat.`}
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
              <MiniSparkline values={s.weekly} width={120} height={22} />
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
