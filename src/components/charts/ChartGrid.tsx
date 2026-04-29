"use client";
// Renders the set of charts currently enabled for a given page, in order.
// Receives the page's fetched data as `ctx` — parent page owns the fetch, so
// switching presets doesn't trigger a re-query.
import { Panel } from "@/components/ui/Panel";
import { CHART_REGISTRY } from "@/lib/charts/registry";
import {
  presetById,
  useChartPrefs,
  useEnsurePrefsInitialized,
} from "@/lib/charts/prefs";
import type { PageId } from "@/lib/charts/types";

export default function ChartGrid<P extends PageId>({
  page,
  ctx,
  emptyMessage = "No charts enabled. Open settings to turn some on.",
}: {
  page: P;
  ctx: unknown;
  emptyMessage?: string;
}) {
  useEnsurePrefsInitialized();
  const { prefs } = useChartPrefs();

  // Fall back to the active preset's defaults when this page hasn't been
  // explicitly customized yet — covers users who set up Phase 1 with only
  // the home page wired and now visit /sellers or /sold for the first
  // time. "custom" presets stay sticky and don't fall back.
  const presetDefaults =
    prefs.preset !== "custom"
      ? presetById(prefs.preset)?.pages[page]
      : undefined;
  const enabledIds = prefs.pages[page] ?? presetDefaults ?? [];

  const entries = enabledIds
    .map((id) => CHART_REGISTRY[id])
    .filter((def): def is NonNullable<typeof def> => Boolean(def));

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-ink-700 bg-ink-850/50 px-4 py-8 text-center text-sm text-ink-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {entries.map((def) => (
        <Panel key={def.id} title={def.title} subtitle={def.subtitle}>
          {def.render(ctx)}
        </Panel>
      ))}
    </div>
  );
}
