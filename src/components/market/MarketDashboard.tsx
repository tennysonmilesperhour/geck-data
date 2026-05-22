"use client";
// Top-level shell for /market.
//
// Filter state is URL-driven through the canonical filter schema in
// src/lib/filters. Tab and selected-combo are URL params too so
// back/forward, refresh, and share all preserve context. The legacy
// MarketFilters shape used by widgets is derived per render via
// toMarketFilters().
//
// This is the cross-filter substrate: any chart on the page that
// calls setFilters({ traits: [...] }) writes to the URL and every
// other panel re-fetches from the new filter set.
import { useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { Filters, Tab } from "@/lib/market/types";
import { TABS } from "@/lib/market/types";
import { useCanonicalFilters } from "@/lib/filters/hook";
import { toMarketFilters, withMarketFilters } from "@/lib/filters/schema";
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

function isTab(s: string | null): s is Tab {
  if (!s) return false;
  return (TABS as ReadonlyArray<string>).includes(s);
}

export default function MarketDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { filters: canonical, setFilters: setCanonical } = useCanonicalFilters();

  const filters: Filters = toMarketFilters(canonical);
  const tab: Tab = isTab(searchParams.get("tab")) ? (searchParams.get("tab") as Tab) : "overview";
  const selectedCombo = searchParams.get("combo");

  // Local non-canonical state goes through router.replace so the URL
  // stays the single source of truth (back/forward / share / refresh).
  const writeLocal = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null) next.delete(k);
        else next.set(k, v);
      }
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setTab = useCallback(
    (t: Tab) => writeLocal({ tab: t === "overview" ? null : t }),
    [writeLocal],
  );
  const setSelectedCombo = useCallback(
    (combo: string | null) => writeLocal({ combo }),
    [writeLocal],
  );

  function jumpToCombo(combo: string) {
    setSelectedCombo(combo);
    setTab("combos");
  }

  // Adapter: existing widgets pass MarketFilters back through onChange.
  // Re-lift into the canonical schema so traits/combos and other extra
  // keys survive the trip.
  const setFilters = useCallback(
    (f: Filters) => {
      setCanonical(withMarketFilters(canonical, f));
    },
    [canonical, setCanonical],
  );

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
