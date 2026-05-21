"use client";
// Top-level shell for /market. Owns the filter + tab state and a
// `selectedCombo` so widgets on one tab can jump into the Combos tab
// preloaded on a specific entry (Top Movers → Combos; Breeders specialty
// → Combos; etc.).
import { useState } from "react";
import type { Filters, Tab } from "@/lib/market/types";
import FilterBar from "./FilterBar";
import OnboardingPanel from "./OnboardingPanel";
import TabNav from "./TabNav";
import OverviewTab from "./tabs/OverviewTab";
import CombosTab from "./tabs/CombosTab";
import RegionalTab from "./tabs/RegionalTab";
import ArbitrageTab from "./tabs/ArbitrageTab";
import SupplyTab from "./tabs/SupplyTab";
import BreedersTab from "./tabs/BreedersTab";
import MarketTemperatureCard from "./MarketTemperatureCard";

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
      <MarketTemperatureCard />
      <FilterBar filters={filters} onChange={setFilters} />
      <OnboardingPanel />
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

      {tab === "regional" && <RegionalTab filters={filters} />}
      {tab === "arbitrage" && <ArbitrageTab filters={filters} />}
      {tab === "supply" && <SupplyTab filters={filters} />}
      {tab === "breeders" && (
        <BreedersTab filters={filters} onSelectCombo={jumpToCombo} />
      )}
    </div>
  );
}
