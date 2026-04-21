"use client";
// Top-level shell for /market. Owns the filter + tab state and a
// `selectedCombo` that lets widgets on one tab jump into the Combos tab
// preloaded on a specific entry (e.g. clicking a Top Mover on Overview
// deep-links into its Combos detail panel).
import { useState } from "react";
import type { Filters, Tab } from "@/lib/market/types";
import PreviewBanner from "./PreviewBanner";
import FilterBar from "./FilterBar";
import TabNav from "./TabNav";
import OverviewTab from "./tabs/OverviewTab";
import CombosTab from "./tabs/CombosTab";

const DEFAULT_FILTERS: Filters = {
  timeframe: "12mo",
  region: "ALL",
  age: "any",
  lineage: "any",
  sources: "all",
};

export default function MarketDashboard() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedCombo, setSelectedCombo] = useState<string | null>(null);

  function jumpToCombo(combo: string) {
    setSelectedCombo(combo);
    setTab("combos");
  }

  return (
    <div className="space-y-4">
      <PreviewBanner />
      <FilterBar filters={filters} onChange={setFilters} />
      <TabNav tab={tab} onChange={setTab} />

      {tab === "overview" && (
        <OverviewTab
          filters={filters}
          onChange={setFilters}
          onSelectCombo={jumpToCombo}
        />
      )}

      {tab === "combos" && (
        <CombosTab
          filters={filters}
          selectedCombo={selectedCombo}
          onSelectCombo={setSelectedCombo}
        />
      )}

      {tab !== "overview" && tab !== "combos" && (
        <div className="forest-surface p-10 text-center text-sm text-forest-300">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-forest-500">
            Coming soon
          </p>
          <p className="mt-2 text-forest-100">
            The <span className="font-mono text-ready">{tab}</span> tab lands
            in the next iteration. Current selection:{" "}
            <span className="font-mono text-ready">{filters.timeframe}</span>{" "}
            · <span className="font-mono text-ready">{filters.region}</span>.
          </p>
        </div>
      )}
    </div>
  );
}
