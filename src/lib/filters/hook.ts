"use client";
// Client-side hook for reading + writing the canonical filter state.
//
// Reads via useSearchParams (subscribes to URL changes). Writes via
// router.replace with scroll preserved so the page does not jump
// when a chip flips. Each mutation is debounced through React's
// transitions so heavy charts do not block typing.
//
// Use `useCanonicalFilters()` on any client component that needs to
// read or write the filters. Server components should call
// `parseFilters(searchParams)` directly.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import {
  CANONICAL_KEYS,
  DEFAULTS,
  parseFilters,
  serialiseFilters,
  type CanonicalFilters,
} from "./schema";

export type Setter = (
  patch:
    | Partial<CanonicalFilters>
    | ((prev: CanonicalFilters) => Partial<CanonicalFilters>),
) => void;

export type UseCanonicalFiltersResult = {
  filters: CanonicalFilters;
  setFilters: Setter;
  resetFilters: () => void;
  isPending: boolean;
};

export function useCanonicalFilters(): UseCanonicalFiltersResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const filters = useMemo(
    () => parseFilters(searchParams),
    [searchParams],
  );

  const setFilters: Setter = useCallback(
    (patch) => {
      const resolved =
        typeof patch === "function" ? patch(filters) : patch;
      const next: CanonicalFilters = { ...filters, ...resolved };
      const out = serialiseFilters(next, new URLSearchParams(searchParams.toString()));
      const q = out.toString();
      const href = q ? `${pathname}?${q}` : pathname;
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [filters, pathname, router, searchParams],
  );

  const resetFilters = useCallback(() => {
    const out = new URLSearchParams(searchParams.toString());
    for (const k of CANONICAL_KEYS) out.delete(k);
    const q = out.toString();
    startTransition(() => {
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    });
  }, [pathname, router, searchParams]);

  return { filters, setFilters, resetFilters, isPending };
}

export { DEFAULTS };
export type { CanonicalFilters };
