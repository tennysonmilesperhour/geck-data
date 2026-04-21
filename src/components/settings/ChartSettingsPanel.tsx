"use client";
// Shared body of the chart-settings UI — rendered both by the header drawer
// and the /settings full-page. Toggles per chart per page + preset selector.
import { useMemo } from "react";
import { CHART_REGISTRY, PLANNED_CHARTS } from "@/lib/charts/registry";
import { PRESETS, useChartPrefs } from "@/lib/charts/prefs";
import type { ChartCategory, PageId } from "@/lib/charts/types";

const CATEGORY_LABEL: Record<ChartCategory, string> = {
  price: "Price",
  traits: "Traits",
  sellers: "Sellers",
  activity: "Activity",
  geo: "Geography",
  relationships: "Relationships",
};

const PAGE_LABEL: Record<PageId, string> = {
  home: "Home / Pulse",
  sold: "Sold",
  sellers: "Sellers",
  "price-drops": "Price Drops",
  shows: "Shows",
  "cross-platform": "Cross-platform",
  trends: "Trends",
  market: "Market",
  compare: "Compare",
};

// Pages wired to ChartGrid so far. Others surface as disabled in the settings
// tree so users can see the roadmap.
const WIRED_PAGES: PageId[] = ["home"];

type Row = {
  id: string;
  title: string;
  description: string;
  category: ChartCategory;
  pages: PageId[];
  implemented: boolean;
};

function collectRows(): Row[] {
  const implemented: Row[] = Object.values(CHART_REGISTRY).map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    pages: d.pages,
    implemented: true,
  }));
  const planned: Row[] = PLANNED_CHARTS.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    pages: d.pages,
    implemented: false,
  }));
  return [...implemented, ...planned];
}

export default function ChartSettingsPanel() {
  const { prefs, applyPreset, toggleChart, resetAll } = useChartPrefs();
  const rows = useMemo(collectRows, []);

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-400">
          Preset
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => {
            const active = prefs.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  active
                    ? "border-claude bg-claude/15 text-claude-glow"
                    : "border-ink-700 bg-ink-850 text-ink-200 hover:border-ink-600 hover:text-ink-50"
                }`}
              >
                <div className="text-sm font-semibold">{p.name}</div>
                <div className="mt-0.5 text-xs text-ink-400">
                  {p.description}
                </div>
              </button>
            );
          })}
        </div>
        {prefs.preset === "custom" ? (
          <div className="mt-3 flex items-center justify-between rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-ink-400">
            <span>Custom layout — not matching any preset.</span>
            <button
              type="button"
              onClick={resetAll}
              className="text-claude hover:text-claude-glow"
            >
              Reset to default
            </button>
          </div>
        ) : null}
      </section>

      {WIRED_PAGES.map((pageId) => {
        const enabled = new Set(prefs.pages[pageId] ?? []);
        const pageRows = rows.filter((r) => r.pages.includes(pageId));
        return (
          <section key={pageId}>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                {PAGE_LABEL[pageId]}
              </span>
              <span className="text-[10px] text-ink-500">
                {enabled.size} enabled
              </span>
            </div>
            <ul className="divide-y divide-ink-700/60 overflow-hidden rounded-lg border border-ink-700 bg-ink-800">
              {pageRows.map((row) => {
                const on = enabled.has(row.id);
                const canToggle = row.implemented;
                return (
                  <li
                    key={row.id}
                    className={`flex items-start gap-3 px-3 py-2.5 ${
                      canToggle
                        ? "cursor-pointer hover:bg-ink-850"
                        : "opacity-60"
                    }`}
                    onClick={() => canToggle && toggleChart(pageId, row.id)}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      readOnly
                      disabled={!canToggle}
                      className="mt-0.5 h-4 w-4 accent-claude"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink-100">{row.title}</span>
                        <span className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-400">
                          {CATEGORY_LABEL[row.category]}
                        </span>
                        {!row.implemented ? (
                          <span className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-500">
                            Coming soon
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-400">
                        {row.description}
                      </div>
                    </div>
                  </li>
                );
              })}
              {pageRows.length === 0 ? (
                <li className="px-3 py-3 text-xs text-ink-500">
                  No charts registered for this page.
                </li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
