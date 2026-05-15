// Small-multiples panel: daily sold count over the last 30 days,
// split into one sparkline per maturity cohort. Lets a breeder
// see at a glance whether juveniles are selling faster than adults
// this month, without going to a full chart screen.
//
// Server component, pure SVG, no client hydration.
import MiniSparkline from "@/components/charts/MiniSparkline";
import { fmtInt } from "@/lib/format";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const MATURITY_ORDER = ["Juvenile", "Subadult", "Adult", "Unknown"] as const;

type SoldRowLite = {
  maturity: string | null;
  sold_at: string | null;
};

function normalise(m: string | null): (typeof MATURITY_ORDER)[number] {
  if (!m) return "Unknown";
  const lower = m.toLowerCase();
  if (lower.startsWith("juv")) return "Juvenile";
  if (lower.startsWith("sub")) return "Subadult";
  if (lower.startsWith("adult")) return "Adult";
  return "Unknown";
}

export default function SoldByMaturity({
  rows,
}: {
  rows: ReadonlyArray<SoldRowLite>;
}) {
  const sinceMs = Date.now() - WINDOW_DAYS * DAY_MS;
  const byMaturity = new Map<string, number[]>();
  for (const m of MATURITY_ORDER) {
    byMaturity.set(m, Array.from({ length: WINDOW_DAYS }, () => 0));
  }
  let totalInWindow = 0;
  for (const r of rows) {
    if (!r.sold_at) continue;
    const t = Date.parse(r.sold_at);
    if (!Number.isFinite(t)) continue;
    const idx = Math.floor((t - sinceMs) / DAY_MS);
    if (idx < 0 || idx >= WINDOW_DAYS) continue;
    const key = normalise(r.maturity);
    const arr = byMaturity.get(key)!;
    arr[idx]! += 1;
    totalInWindow++;
  }

  if (totalInWindow === 0) {
    return null;
  }

  const cohorts = MATURITY_ORDER.map((label) => {
    const daily = byMaturity.get(label)!;
    const total = daily.reduce((a, b) => a + b, 0);
    return { label, daily, total };
  });

  return (
    <section className="surface p-5">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[20px] font-medium tracking-tight text-ink-50">
            What&apos;s selling — by maturity
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            Daily sold count over the last 30 days, split by maturity cohort.
            Compare shape (when each cohort is moving) and total (which
            cohort is the deepest market).
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-500">
          n = {fmtInt(totalInWindow)} in 30d
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cohorts.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-ink-700/60 bg-ink-900/40 p-4"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[15px] font-medium text-ink-100">
                {c.label}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink-300">
                {fmtInt(c.total)}
              </span>
            </div>
            <div className="mt-3">
              {c.total > 0 ? (
                <MiniSparkline
                  values={c.daily}
                  width={220}
                  height={42}
                  fill
                />
              ) : (
                <div className="h-[42px] rounded border border-dashed border-ink-700/60 px-2 py-1 text-[10px] text-ink-500">
                  No sold listings in this cohort over the window.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
