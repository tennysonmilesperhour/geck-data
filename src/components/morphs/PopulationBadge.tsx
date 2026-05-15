// Combo population summary — the "how many of this thing exist /
// have sold" framing borrowed from PSA Pop Reports and TCGPlayer.
// Replaces ad-hoc `live N / sold N` strings scattered through the
// app so the same data carries the same visual weight everywhere.
//
// Three sizes:
//   sm — inline next to a combo name in a table row
//   md — under a combo card title
//   lg — combo-detail hero, sits next to the median price
import { fmtInt } from "@/lib/format";

type Size = "sm" | "md" | "lg";

const SIZE_TYPE: Record<Size, string> = {
  sm: "text-[10px]",
  md: "text-[11px]",
  lg: "text-[13px]",
};

const SIZE_GAP: Record<Size, string> = {
  sm: "gap-2",
  md: "gap-2.5",
  lg: "gap-3",
};

export default function PopulationBadge({
  live,
  sold,
  /** Optional window label for the sold count, e.g. "90d". Default
   *  "all time" if not specified — keeps the component honest about
   *  what the number means. */
  soldWindow = "all time",
  size = "sm",
  tone = "ink",
  className = "",
}: {
  live: number | null | undefined;
  sold: number | null | undefined;
  soldWindow?: string;
  size?: Size;
  tone?: "ink" | "forest";
  className?: string;
}) {
  const liveN = typeof live === "number" ? fmtInt(live) : "—";
  const soldN = typeof sold === "number" ? fmtInt(sold) : "—";
  const muted = tone === "forest" ? "text-forest-500" : "text-ink-500";
  const accent = tone === "forest" ? "text-forest-100" : "text-ink-100";
  return (
    <span
      className={`inline-flex items-baseline ${SIZE_GAP[size]} font-mono tabular-nums ${SIZE_TYPE[size]} uppercase tracking-[0.12em] ${muted} ${className}`}
      aria-label={`${liveN} live, ${soldN} sold (${soldWindow})`}
    >
      <span>
        <span className={accent}>{liveN}</span> live
      </span>
      <span aria-hidden className="opacity-50">
        ·
      </span>
      <span>
        <span className={accent}>{soldN}</span> sold ({soldWindow})
      </span>
    </span>
  );
}
