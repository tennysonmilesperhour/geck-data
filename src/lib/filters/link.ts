// Build hrefs that preserve filter state across nav.
//
// Pages always pass their current `searchParams` (server) or
// `useSearchParams()` (client) in, plus the route they want to point
// at, plus a partial override. The helper writes a clean canonical
// projection on top of the current state so links carry context
// forward without leaking page-local junk.

import { type ReadonlyURLSearchParams } from "next/navigation";
import {
  CANONICAL_KEYS,
  DEFAULTS,
  parseFilters,
  serialiseFilters,
  type CanonicalFilters,
} from "./schema";

type AnyParams =
  | URLSearchParams
  | ReadonlyURLSearchParams
  | Record<string, string | string[] | undefined>
  | undefined
  | null;

function toURLSearchParams(src: AnyParams): URLSearchParams {
  if (!src) return new URLSearchParams();
  if (src instanceof URLSearchParams) return new URLSearchParams(src.toString());
  // ReadonlyURLSearchParams duck-types as URLSearchParams for toString.
  const maybeStringable = src as { toString?: () => string };
  if (typeof maybeStringable.toString === "function") {
    try {
      const str = maybeStringable.toString();
      // The default Object.toString returns "[object Object]"; reject
      // that and fall through to manual coercion.
      if (typeof str === "string" && !str.startsWith("[object ")) {
        return new URLSearchParams(str);
      }
    } catch {
      /* fall through */
    }
  }
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(
    src as Record<string, string | string[] | undefined>,
  )) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((vv) => out.append(k, vv));
    else out.set(k, v);
  }
  return out;
}

export type LinkOptions = {
  /** Drop all canonical filter keys before adding the override. */
  reset?: boolean;
};

export function filterHref(
  path: string,
  current: AnyParams,
  override: Partial<CanonicalFilters> = {},
  opts: LinkOptions = {},
): string {
  const params = toURLSearchParams(current);
  if (opts.reset) for (const k of CANONICAL_KEYS) params.delete(k);
  const base = parseFilters(params);
  const next: CanonicalFilters = { ...base, ...override };
  const serial = serialiseFilters(next, params);
  const q = serial.toString();
  return q ? `${path}?${q}` : path;
}

// Shortcut: same as filterHref but takes only the override and
// expects the caller's existing query string as a URLSearchParams.
export function withFilters(
  path: string,
  current: AnyParams,
  override: Partial<CanonicalFilters>,
): string {
  return filterHref(path, current, override);
}

// Server-side helper: given Next.js searchParams record + route +
// override, produce the href.
export function serverHref(
  path: string,
  searchParams: Record<string, string | string[] | undefined> | undefined,
  override: Partial<CanonicalFilters> = {},
): string {
  return filterHref(path, searchParams, override);
}

export { DEFAULTS, parseFilters, serialiseFilters };
export type { CanonicalFilters };
