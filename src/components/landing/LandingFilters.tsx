"use client";
// Shared filter context for the landing page. Two pieces of state:
//   - hoveredCombo: which combo row in WhatsHot the cursor is on; widgets
//     that consume this should highlight matching content.
//   - selectedCombos: a Set of combo names that filter the Opportunities
//     and What's Hot list. Clicking a What's Hot row toggles its combo into
//     the set. Empty = no filter.
//   - priceBand: optional [min, max] in USD; sets via the price slider.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type LandingFilterState = {
  hoveredCombo: string | null;
  selectedCombos: Set<string>;
  priceBand: [number, number] | null;
  setHoveredCombo: (combo: string | null) => void;
  toggleCombo: (combo: string) => void;
  clearCombos: () => void;
  setPriceBand: (band: [number, number] | null) => void;
};

const noop: LandingFilterState = {
  hoveredCombo: null,
  selectedCombos: new Set(),
  priceBand: null,
  setHoveredCombo: () => {},
  toggleCombo: () => {},
  clearCombos: () => {},
  setPriceBand: () => {},
};

const Ctx = createContext<LandingFilterState>(noop);

export function LandingFiltersProvider({ children }: { children: ReactNode }) {
  const [hoveredCombo, setHoveredComboState] = useState<string | null>(null);
  const [selectedCombos, setSelectedCombos] = useState<Set<string>>(
    () => new Set(),
  );
  const [priceBand, setPriceBandState] = useState<[number, number] | null>(null);

  const setHoveredCombo = useCallback((c: string | null) => {
    setHoveredComboState(c);
  }, []);

  const toggleCombo = useCallback((combo: string) => {
    setSelectedCombos((prev) => {
      const next = new Set(prev);
      if (next.has(combo)) next.delete(combo);
      else next.add(combo);
      return next;
    });
  }, []);

  const clearCombos = useCallback(() => {
    setSelectedCombos(new Set());
  }, []);

  const setPriceBand = useCallback((band: [number, number] | null) => {
    setPriceBandState(band);
  }, []);

  const value = useMemo<LandingFilterState>(
    () => ({
      hoveredCombo,
      selectedCombos,
      priceBand,
      setHoveredCombo,
      toggleCombo,
      clearCombos,
      setPriceBand,
    }),
    [
      hoveredCombo,
      selectedCombos,
      priceBand,
      setHoveredCombo,
      toggleCombo,
      clearCombos,
      setPriceBand,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLandingFilters() {
  return useContext(Ctx);
}
