"use client";
// Pill-style badge shown next to any number that has a source. Hovering
// reveals the full label + description; clicking (future) opens a drawer
// that lists the underlying rows. Colored by source kind to distinguish
// internal (GI sales/listings) from external (Pangea, MorphMarket) from
// breeder-direct at a glance.
import type { SourceId } from "@/lib/market/types";
import { sourceMeta } from "@/lib/market/sources";

export default function SourceBadge({
  id,
  size = "sm",
  active,
  onClick,
}: {
  id: SourceId;
  size?: "sm" | "md";
  active?: boolean;
  onClick?: () => void;
}) {
  const m = sourceMeta(id);
  const px = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs";
  const icon = m.kind === "internal" ? "◈" : m.kind === "breeder" ? "☁" : "◇";
  const cls = active
    ? "bg-ink-750 text-ink-50"
    : "bg-ink-850/80 text-ink-200 hover:bg-ink-800";

  const Tag = onClick ? "button" : ("span" as const);

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={`${m.label} — ${m.description}`}
      className={`inline-flex items-center gap-1 rounded-md border border-ink-700 font-mono ${px} ${cls}`}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: m.color }}
      />
      <span aria-hidden className="text-ink-500">
        {icon}
      </span>
      <span>{m.short}</span>
    </Tag>
  );
}

// Compact overflow shown when a list would otherwise be too long:
// "[GI sales] [GI listings] [Pangea] +4 more"
export function SourceBadgeList({
  ids,
  max = 3,
  size = "sm",
  onBadgeClick,
}: {
  ids: SourceId[];
  max?: number;
  size?: "sm" | "md";
  onBadgeClick?: (id: SourceId) => void;
}) {
  const shown = ids.slice(0, max);
  const extra = Math.max(0, ids.length - max);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {shown.map((id) => (
        <SourceBadge
          key={id}
          id={id}
          size={size}
          onClick={onBadgeClick ? () => onBadgeClick(id) : undefined}
        />
      ))}
      {extra > 0 ? (
        <span className="rounded-md border border-ink-700 bg-ink-850/80 px-1.5 py-0.5 font-mono text-[10px] text-ink-300">
          +{extra} more
        </span>
      ) : null}
    </span>
  );
}
