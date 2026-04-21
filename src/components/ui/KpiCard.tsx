// Small stat tile for dashboard overviews. Title + big number + optional
// sublabel / trend direction. Server-component-safe (no client hooks).
export type KpiCardProps = {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "positive" | "negative" | "warn";
};

const toneClasses: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "text-gecko-dark",
  positive: "text-gecko",
  negative: "text-red-700",
  warn: "text-amber-600",
};

export default function KpiCard({ label, value, sub, tone = "default" }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClasses[tone]}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub ? <div className="mt-1 text-xs text-neutral-500">{sub}</div> : null}
    </div>
  );
}
