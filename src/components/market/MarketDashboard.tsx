"use client";
// Top-level shell for /market. Owns the filter + tab state and threads
// `Filters` down to whichever tab is active. Each tab panel lands as its
// own follow-up task; this commit just wires the shell and renders a
// forest-themed placeholder so the nav is live end-to-end.
import { useState } from "react";
import type { Filters, Tab } from "@/lib/market/types";
import PreviewBanner from "./PreviewBanner";
import FilterBar from "./FilterBar";
import TabNav from "./TabNav";

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

  return (
    <div className="space-y-4">
      <PreviewBanner />
      <FilterBar filters={filters} onChange={setFilters} />
      <TabNav tab={tab} onChange={setTab} />

      <div className="forest-surface p-10 text-center text-sm text-forest-300">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-forest-500">
          Task 1 · shell
        </p>
        <p className="mt-2 text-forest-100">
          Showing <span className="font-mono text-ready">{tab}</span> tab with{" "}
          <span className="font-mono text-ready">{filters.timeframe}</span> /{" "}
          <span className="font-mono text-ready">{filters.region}</span> filters.
        </p>
        <p className="mt-1 text-xs text-forest-500">
          Widgets land one tab at a time — Overview is next (Market Index, Top
          Movers, Market Calendar).
        </p>
      </div>
    </div>
  );
}
