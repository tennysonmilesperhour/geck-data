// Heavy trait-momentum computation, lifted into its own async server
// component so the rest of /trends can stream while this finishes.
// Suspense wraps the call site; this component never renders to the
// initial shell. CPU cost = touching ~20k listings.
import { Panel } from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { fmtPct } from "@/lib/format";

const DAY_MS = 86_400_000;

type Row = {
  norm_traits: string | null;
  cached_traits: string | null;
  first_seen_at: string | null;
};

function traitCounts(rows: Row[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const raw = (r.norm_traits || r.cached_traits || "").toLowerCase();
    if (!raw) continue;
    const tokens = raw.includes(",")
      ? raw.split(",").map((t) => t.trim())
      : raw.split(/\s+/).map((t) => t.trim());
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!t || t.length < 3 || seen.has(t)) continue;
      seen.add(t);
      m.set(t, (m.get(t) ?? 0) + 1);
    }
  }
  return m;
}

export default async function TraitMomentumPanels() {
  const supabase = createClient();
  const since14 = new Date(Date.now() - 14 * DAY_MS).toISOString();
  const prev14Start = Date.now() - 28 * DAY_MS;
  const prev14End = Date.now() - 14 * DAY_MS;

  const { data } = await supabase
    .from("market_listings")
    .select("norm_traits, cached_traits, first_seen_at")
    .gte("first_seen_at", new Date(prev14Start).toISOString())
    .limit(20000);

  const all = (data ?? []) as Row[];
  const recentListings = all.filter((r) => {
    if (!r.first_seen_at) return false;
    const t = Date.parse(r.first_seen_at);
    return Number.isFinite(t) && t >= Date.parse(since14);
  });
  const priorListings = all.filter((r) => {
    if (!r.first_seen_at) return false;
    const t = Date.parse(r.first_seen_at);
    return Number.isFinite(t) && t >= prev14Start && t < prev14End;
  });

  const recentTraits = traitCounts(recentListings);
  const priorTraits = traitCounts(priorListings);
  const allTraitKeys = new Set<string>([
    ...recentTraits.keys(),
    ...priorTraits.keys(),
  ]);

  const momentum: Array<{
    trait: string;
    recent: number;
    prior: number;
    delta: number;
  }> = [];
  for (const t of allTraitKeys) {
    const r = recentTraits.get(t) ?? 0;
    const p = priorTraits.get(t) ?? 0;
    if (r + p < 4) continue; // noise floor
    const delta = p === 0 ? (r > 0 ? 100 : 0) : ((r - p) / p) * 100;
    momentum.push({ trait: t, recent: r, prior: p, delta });
  }

  const topRising = [...momentum]
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10);
  const topFalling = [...momentum]
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 10);

  return (
    <>
      {/* Beginner framing — what does this section actually mean? */}
      <div className="rounded-xl border border-ink-700/60 bg-ink-850/60 px-4 py-3 text-sm text-ink-300">
        <span className="font-display font-medium text-ink-50">
          How to read this:
        </span>{" "}
        we count how often each trait shows up in new listings during the last
        14 days versus the 14 days before that. A trait gets a green % if it&apos;s
        appearing more often — interest is rising — and a red % if it&apos;s fading.
        Useful for spotting which morphs are trending up before the price catches
        up.
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Panel
          title="Rising traits · 14d"
          subtitle="Trait appearances in new listings versus the prior 14d window."
        >
          <ul className="divide-y divide-ink-700/60 font-mono text-[13px]">
            {topRising.map((m) => (
              <li
                key={m.trait}
                className="flex items-center justify-between py-1.5"
              >
                <span className="text-ink-100">{m.trait}</span>
                <span className="flex items-center gap-3">
                  <span className="text-ink-400">
                    {m.prior} → {m.recent}
                  </span>
                  <span className="w-16 text-right text-ready">
                    {fmtPct(m.delta, 0)}
                  </span>
                </span>
              </li>
            ))}
            {topRising.length === 0 ? (
              <li className="py-3 text-ink-500">Not enough new listings yet.</li>
            ) : null}
          </ul>
        </Panel>

        <Panel
          title="Cooling traits · 14d"
          subtitle="Trait appearances dropping versus the prior 14d window."
        >
          <ul className="divide-y divide-ink-700/60 font-mono text-[13px]">
            {topFalling.map((m) => (
              <li
                key={m.trait}
                className="flex items-center justify-between py-1.5"
              >
                <span className="text-ink-100">{m.trait}</span>
                <span className="flex items-center gap-3">
                  <span className="text-ink-400">
                    {m.prior} → {m.recent}
                  </span>
                  <span className="w-16 text-right text-danger">
                    {fmtPct(m.delta, 0)}
                  </span>
                </span>
              </li>
            ))}
            {topFalling.length === 0 ? (
              <li className="py-3 text-ink-500">Not enough new listings yet.</li>
            ) : null}
          </ul>
        </Panel>
      </div>
    </>
  );
}

export function TraitMomentumSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="surface p-5"
          aria-label="Loading trait momentum"
        >
          <div className="mb-3 h-4 w-32 animate-pulse rounded bg-ink-800" />
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, j) => (
              <div
                key={j}
                className="h-5 animate-pulse rounded bg-ink-800/70"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
