"use client";
// Upcoming expos + breeder releases, bucketed into "this month" vs "later".
// Colored dot reflects the kind (expo vs release). The relative date label
// matches the screenshots' "US 8d ago" / "JP Jun 19" style.
import type { CalendarEntry } from "@/lib/market/widget-types";

export default function MarketCalendarPanel({
  entries,
}: {
  entries: CalendarEntry[];
}) {
  // Sort ascending by date, then split into "past/near" and "later" just so
  // the list has shape. Events in the past render with a relative "Xd ago"
  // label instead of the raw date.
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <section className="forest-surface p-5">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
        >
          ▦
        </span>
        <div>
          <h2 className="font-display text-[18px] font-medium tracking-tight text-forest-50">Market Calendar</h2>
          <p className="mt-0.5 text-xs text-forest-400">
            Upcoming expos &amp; breeder releases
          </p>
        </div>
      </header>

      <ul className="mt-4 space-y-2.5">
        {sorted.length === 0 ? (
          <li className="py-3 text-xs text-forest-500">Nothing on the calendar yet.</li>
        ) : (
          sorted.map((e) => (
            <li
              key={`${e.label}-${e.date}`}
              className="flex items-center gap-3"
            >
              <Dot kind={e.kind} />
              <span className="flex-1 truncate text-sm text-forest-100">
                {e.label}
              </span>
              <span className="font-mono text-[11px] text-forest-400">
                {e.region}
              </span>
              <span className="w-16 text-right font-mono text-[11px] text-forest-300">
                {labelDate(e.date)}
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function Dot({ kind }: { kind: CalendarEntry["kind"] }) {
  // Color code: expo = amber (event on a fixed date), release = rose (drop).
  const bg = kind === "expo" ? "#fbbf24" : "#f472b6";
  return (
    <span
      aria-label={kind}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{
        backgroundColor: bg,
        boxShadow: `0 0 0 3px ${bg}25`,
      }}
    />
  );
}

function labelDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const now = Date.now();
  const diffDays = Math.round((t - now) / 86_400_000);
  if (diffDays < 0 && diffDays >= -60) return `${-diffDays}d ago`;
  // "Mon DD" — consistent with screenshot's "Jun 1" format.
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
