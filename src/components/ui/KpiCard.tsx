// Small stat tile for dashboard overviews. Title + big number + optional
// sublabel / trend direction. Server-component-safe (no client hooks).
export type KpiCardProps = {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "positive" | "negative" | "warn" | "info";
  delta?: { value: number; label?: string }; // percent change
};

const toneClasses: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "text-ink-50",
  positive: "text-ready",
  negative: "text-danger",
  warn: "text-busy",
  info: "text-info",
};

function fmtDelta(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export default function KpiCard({ label, value, sub, tone = "default", delta }: KpiCardProps) {
  const deltaPositive = delta && delta.value >= 0;
  return (
    <div className="group relative overflow-hidden rounded-lg border border-ink-700 bg-ink-800 p-4 shadow-panel transition hover:border-ink-600">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ink-600/50 to-transparent" />
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
          {label}
        </div>
        {delta ? (
          <div
            className={`font-mono text-[11px] ${
              deltaPositive ? "text-ready" : "text-danger"
            }`}
          >
            {fmtDelta(delta.value)}
            {delta.label ? <span className="ml-1 text-ink-500">{delta.label}</span> : null}
          </div>
        ) : null}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneClasses[tone]}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub ? <div className="mt-1 text-xs text-ink-400">{sub}</div> : null}
    </div>
  );
}
