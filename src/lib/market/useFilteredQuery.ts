"use client";
// Tiny generic hook: call an async `fetch(filters, ...args)` whenever the
// filters or args change, return { data, live, loading, note }. Safe
// against race conditions via a mounted-ref: if the user changes filters
// while the previous fetch is in flight, the late response is ignored.
//
// Every /market widget calls this with the appropriate queries.ts fetcher.
import { useEffect, useRef, useState } from "react";
import type { QueryResult } from "./queries";
import type { Filters } from "./types";

export type Status = "loading" | "live" | "preview";

export type QueryState<T> = {
  data: T | null;
  live: boolean;
  loading: boolean;
  note?: string;
  status: Status;
};

export function useFilteredQuery<T, Args extends readonly unknown[]>(
  fetcher: (filters: Filters, ...args: Args) => Promise<QueryResult<T>>,
  filters: Filters,
  args: Args,
  keyArgs?: string,
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({
    data: null,
    live: false,
    loading: true,
    status: "loading",
  });
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setState((s) => ({ ...s, loading: true, status: "loading" }));
    fetcher(filters, ...args)
      .then((res) => {
        if (id !== reqId.current) return;
        setState({
          data: res.data,
          live: res.live,
          loading: false,
          note: res.attributionNote,
          status: res.live ? "live" : "preview",
        });
      })
      .catch((e) => {
        if (id !== reqId.current) return;
        setState({
          data: null,
          live: false,
          loading: false,
          note: e instanceof Error ? e.message : String(e),
          status: "preview",
        });
      });
    // Rerun whenever filters or caller-provided key string changes. Args
    // shouldn't be in the dep array raw (arrays recreate each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, keyArgs]);

  return state;
}
