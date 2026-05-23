// Central slug + canonical-name resolution for traits and combos.
//
// Background: a trait's stored canonical name (e.g. "Tri-color" or
// "Lilly White") doesn't survive a naive slug round-trip, because
// `slugifyTrait("Tri-color")` collapses the hyphen and a space into
// the same "-" character, so `unslugTrait("tri-color")` returns
// "Tri Color" (no hyphen) and an ILIKE on cached_traits silently
// matches zero rows. This module owns the "given a slug, give me the
// trait name as it actually appears in the data" lookup.
//
// Combo slugs use a similar two-trait form ("axanthic__lilly-white").
// The DB stores combo_id as `"Trait A x Trait B"`; this module
// converts both directions.

import type { SupabaseClient } from "@supabase/supabase-js";
import { slugifyTrait, unslugTrait } from "@/lib/filters/schema";
import { HIGH_VALUE_COMBOS, type CanonicalCombo } from "@/lib/market/combos";

/** "Axanthic x Lilly White" -> "axanthic__lilly-white" (sorted). */
export function comboSlugFromId(combo_id: string): string {
  const parts = combo_id.split(/\s+x\s+/i);
  if (parts.length === 2) {
    const slugs = parts
      .map((p) => slugifyTrait(p.trim()))
      .filter(Boolean)
      .sort();
    return slugs.join("__");
  }
  // Legacy short id (lw-cap, axa-pin, etc) — already URL-safe.
  return slugifyTrait(combo_id);
}

/** Split "axanthic__lilly-white" -> ["axanthic", "lilly-white"]. */
export function comboPartsFromSlug(slug: string): [string, string] | null {
  if (!slug.includes("__")) return null;
  const parts = slug
    .split("__")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  return [parts[0]!, parts[1]!];
}

/**
 * Resolve a trait slug to the canonical trait name as stored in
 * market_listings.cached_traits. Queries v_observed_traits and
 * compares slugified names. Falls back to unslugTrait when no
 * canonical match exists.
 */
export async function resolveTraitName(
  supabase: SupabaseClient,
  slug: string,
): Promise<{ trait: string; canonical: boolean }> {
  const { data } = await supabase
    .from("v_observed_traits")
    .select("trait")
    .limit(2000);
  const rows = (data ?? []) as Array<{ trait: string }>;
  for (const r of rows) {
    if (slugifyTrait(r.trait) === slug) {
      return { trait: r.trait, canonical: true };
    }
  }
  return { trait: unslugTrait(slug), canonical: false };
}

/**
 * Resolve a combo slug (either legacy short id like "lw-cap" or
 * trait-pair form like "axanthic__lilly-white") to a CanonicalCombo.
 * For trait-pair form, looks each half up in v_observed_traits so
 * "tri-color" recovers as "Tri-color" not "Tri Color".
 */
export async function resolveComboFromSlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<CanonicalCombo | null> {
  const legacy = HIGH_VALUE_COMBOS.find((c) => c.id === slug);
  if (legacy) return legacy;
  const parts = comboPartsFromSlug(slug);
  if (!parts) return null;
  const [aSlug, bSlug] = parts;

  const { data } = await supabase
    .from("v_observed_traits")
    .select("trait")
    .limit(2000);
  const traits = (data ?? []) as Array<{ trait: string }>;
  const bySlug = new Map<string, string>();
  for (const r of traits) bySlug.set(slugifyTrait(r.trait), r.trait);

  const a = bySlug.get(aSlug) ?? unslugTrait(aSlug);
  const b = bySlug.get(bSlug) ?? unslugTrait(bSlug);
  if (!a || !b) return null;
  return {
    id: slug,
    name: `${a} x ${b}`,
    display: `${a} × ${b}`,
    traits: [a, b],
  };
}
