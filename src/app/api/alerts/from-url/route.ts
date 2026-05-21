// Save the current filter state of /sellers, /trends, etc. as a new alert.
//
//   POST /api/alerts/from-url
//     body: { name: string, url: string }
//
// Reads the URL's query string and translates the supported filter params
// into the alerts.query jsonb shape that lib/alerts/matcher.ts understands.
//
// Supported params:
//   ?combo=lw-axa            -> trait_all derived from combo definition
//   ?traits=axanthic,pinstripe -> trait_all
//   ?min_price=100&max_price=500
//   ?regions=US,UK
//   ?seller=<id>             -> seller_ids
//   ?must_be_drop=1
//
// Auth: requires a session; the alert is owned by the user.

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { HIGH_VALUE_COMBOS } from "@/lib/market/combos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AlertQuery = {
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

function queryFromUrl(input: string): AlertQuery {
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

export async function POST(req: NextRequest) {
  const supa = createServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { name?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const url = (body.url ?? "").trim();
  if (!name || !url) {
    return NextResponse.json({ error: "name and url required" }, { status: 400 });
  }
  const query = queryFromUrl(url);
  if (Object.keys(query).length === 0) {
    return NextResponse.json(
      { error: "could not derive any filter from url" },
      { status: 400 },
    );
  }

  // alerts table has owner-scoped INSERT with auth.uid() = owner_id.
  const { data, error } = await supa
    .from("alerts")
    .insert({
      owner_id: user.id,
      name,
      query,
      active: true,
    })
    .select("id, query")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ alert: data });
}

// Exposed for the test suite.
export const _internal = { queryFromUrl };
