// "Last updated" stamp + optional time-window label. Surfaces a real
// timestamp instead of the hardcoded marketing copy ("Freshness ≤ 12h")
// the app used to ship. Use on every page header that displays
// numeric data so the user always knows when and over what window.
//
// Usage:
//   <DataFreshness updatedAt={snapshot.generated_at} window="30 days" />
//   <DataFreshness updatedAt={new Date()} window="14 days" tone="forest" />
//
// The `tone` prop lets /market (forest-themed) match its scope; default
// works on every ink-themed page.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function relative(ts: Date | string | number | null | undefined): string {
  if (!ts) return "unknown";
  const t = ts instanceof Date ? ts.getTime() : Date.parse(String(ts));
  if (!Number.isFinite(t)) return "unknown";
  const delta = Date.now() - t;
  if (delta < 0) return "just now";
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) {
    const m = Math.floor(delta / MINUTE);
    return `${m}m ago`;
  }
  if (delta < DAY) {
    const h = Math.floor(delta / HOUR);
    return `${h}h ago`;
  }
  const d = Math.floor(delta / DAY);
  return `${d}d ago`;
}

export default function DataFreshness({
  updatedAt,
  window,
  tone = "ink",
  className = "",
}: {
  updatedAt: Date | string | number | null | undefined;
  /** Optional human window label, e.g. "30 days", "all time". */
  window?: string;
  /** Match the surrounding theme. */
  tone?: "ink" | "forest";
  className?: string;
}) {
  const ago = relative(updatedAt);
  const muted = tone === "forest" ? "text-forest-500" : "text-ink-500";
  const accent = tone === "forest" ? "text-forest-300" : "text-ink-300";
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] ${muted} ${className}`}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-ready/70" />
      <span>
        updated <span className={accent}>{ago}</span>
      </span>
      {window ? (
        <span aria-hidden className="opacity-50">
          ·
        </span>
      ) : null}
      {window ? (
        <span>
          window <span className={accent}>{window}</span>
        </span>
      ) : null}
    </span>
  );
}
