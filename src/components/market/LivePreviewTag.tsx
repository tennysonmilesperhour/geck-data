"use client";
// Small pill shown in the corner of a /market panel to tell the reader
// whether the widget is reading real Supabase rows or a fixture
// fallback. Three visual states:
//
//   loading  — grey, "…"
//   live     — emerald, "live"
//   preview  — amber,  "preview"
//
// Hover reveals the `note` string (e.g. "v_combo_rollups(90d)" or the
// error message that triggered the fallback).
export type LivePreviewStatus = "loading" | "live" | "preview";

export default function LivePreviewTag({
  status,
  note,
}: {
  status: LivePreviewStatus;
  note?: string;
}) {
  const map: Record<LivePreviewStatus, { cls: string; label: string; dot: string }> = {
    loading: {
      cls: "border-forest-700 bg-forest-900/70 text-forest-400",
      label: "loading",
      dot: "bg-forest-500",
    },
    live: {
      cls: "border-ready/40 bg-ready/10 text-ready",
      label: "live",
      dot: "bg-ready",
    },
    preview: {
      cls: "border-busy/40 bg-busy/10 text-busy",
      label: "preview",
      dot: "bg-busy",
    },
  };
  const m = map[status];
  return (
    <span
      title={note ?? m.label}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${m.cls}`}
    >
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}
