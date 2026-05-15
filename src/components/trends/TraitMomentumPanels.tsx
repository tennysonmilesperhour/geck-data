// Trait activity — per-trait daily sparkline + slope + total count over
// the last 14 days. Replaces the old "rising / cooling" %-delta view
// that showed flat 100% for every trait when the prior 14-day window
// had no data yet.
//
// What we render now:
//   - One row per trait (sorted by total appearances, most popular first)
//   - 14-day daily sparkline of appearances in NEW listings
//   - Total count over the window
//   - Slope tag derived from comparing the late 7 days to the early 7:
//       ↑ rising  : late half count is at least 20% higher than the early half
//       ↓ cooling : late half is at least 20% lower than the early half
//       ✦ new     : early half had zero appearances, late half has >= 2
//       − flat    : everything else
//
// All computed off listings.first_seen_at — no synthetic data, no
// 100% deltas when the prior window is empty.
import { Panel } from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { fmtInt } from "@/lib/format";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14;
const SPARKLINE_W = 96;
const SPARKLINE_H = 22;

type Row = {
  norm_traits: string | null;
  cached_traits: string | null;
  first_seen_at: string | null;
};

type SlopeKind = "rising" | "cooling" | "new" | "flat";

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
  const raw = (r.norm_traits || r.cached_traits || "").toLowerCase();
  if (!raw) return [];
  const tokens = raw.includes(",")
    ? raw.split(",").map((t) => t.trim())
    : raw.split(/\s+/).map((t) => t.trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!t || t.length < 3 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function classifySlope(early: number, late: number): SlopeKind {
  if (early === 0 && late >= 2) return "new";
  if (early === 0) return "flat";
  const ratio = (late - early) / early;
  if (ratio >= 0.2) return "rising";
  if (ratio <= -0.2) return "cooling";
  return "flat";
}

function sparklinePath(values: number[], peak: number): string {
  if (values.length < 2 || peak <= 0) return "";
  const stepX = (SPARKLINE_W - 2) / (values.length - 1);
  let d = "";
  for (let i = 0; i < values.length; i++) {
    const x = 1 + i * stepX;
    const y = SPARKLINE_H - 1 - (values[i]! / peak) * (SPARKLINE_H - 2);
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d.trim();
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

function SlopeTag({ kind }: { kind: SlopeKind }) {
  const map: Record<SlopeKind, { label: string; cls: string; glyph: string }> = {
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
  const m = map[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] ${m.cls}`}
    >
      <span aria-hidden>{m.glyph}</span>
      {m.label}
    </span>
  );
}

function Sparkline({
  daily,
  kind,
}: {
  daily: number[];
  kind: SlopeKind;
}) {
  const peak = Math.max(1, ...daily);
  const path = sparklinePath(daily, peak);
  const color =
    kind === "rising"
      ? "#4ade80"
      : kind === "cooling"
        ? "#f87171"
        : kind === "new"
          ? "#60a5fa"
          : "#6b7b71";
  return (
    <svg
      width={SPARKLINE_W}
      height={SPARKLINE_H}
      viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
      aria-hidden
      className="shrink-0"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    </svg>
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
              <Sparkline daily={s.daily} kind={kind} />
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
