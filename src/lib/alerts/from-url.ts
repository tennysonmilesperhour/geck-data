// Pure URL → AlertQuery translator. Lives outside route.ts because Next.js
// rejects non-handler exports from route files (see PR #111 Vercel build).
// The route imports queryFromUrl from here and is otherwise unchanged.
import { HIGH_VALUE_COMBOS } from "@/lib/market/combos";

export type AlertQuery = {
  trait_all?: string[];
  min_price?: number;
  max_price?: number;
  regions?: string[];
  seller_ids?: string[];
  must_be_drop?: boolean;
};

function parseList(v: string | null): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function queryFromUrl(input: string): AlertQuery {
  // Accept: absolute URLs ("https://…?x=y"), path+query ("/market?x=y"),
  // or bare query string ("x=y&z=w"). For the relative cases we re-parse
  // against a placeholder base so URL() is happy and the searchParams API
  // does the heavy lifting.
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    const norm = input.includes("?")
      ? `http://x${input.startsWith("/") ? input : "/" + input}`
      : `http://x/?${input}`;
    parsed = new URL(norm);
  }
  const sp = parsed.searchParams;
  const out: AlertQuery = {};

  const combo = sp.get("combo");
  if (combo) {
    const def = HIGH_VALUE_COMBOS.find((c) => c.id === combo);
    if (def) out.trait_all = def.traits;
  }

  const traits = parseList(sp.get("traits"));
  if (traits.length) out.trait_all = [...(out.trait_all ?? []), ...traits];

  const min = Number(sp.get("min_price"));
  if (Number.isFinite(min) && min > 0) out.min_price = min;
  const max = Number(sp.get("max_price"));
  if (Number.isFinite(max) && max > 0) out.max_price = max;

  const regions = parseList(sp.get("regions"));
  if (regions.length) out.regions = regions;

  const seller = sp.get("seller");
  if (seller) out.seller_ids = [seller];

  if (sp.get("must_be_drop") === "1" || sp.get("must_be_drop") === "true") {
    out.must_be_drop = true;
  }

  return out;
}
