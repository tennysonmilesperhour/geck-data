// Filter-preset persistence for /market.
//
// v1 storage: localStorage, per-browser. A named preset is just a snapshot
// of `Filters`. We can upgrade to a Supabase-backed `market_filter_presets`
// table later without changing the public API — this module is the only
// place call sites touch preset state.
//
// Sources are serialized as "all" or an array (we can't JSON a Set<>).
import type { Filters, SourceId } from "./types";

const KEY = "geck_market_presets.v1";

export type Preset = {
  id: string;         // stable key for React + delete; generated at save time
  name: string;       // user-supplied label
  createdAt: string;  // ISO
  filters: SerializedFilters;
};

type SerializedFilters = Omit<Filters, "sources"> & {
  sources: "all" | SourceId[];
};

function serialize(f: Filters): SerializedFilters {
  return {
    ...f,
    sources: f.sources === "all" ? "all" : Array.from(f.sources),
  };
}

export function deserialize(s: SerializedFilters): Filters {
  return {
    ...s,
    sources: s.sources === "all" ? "all" : new Set(s.sources),
  };
}

export function listPresets(): Preset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPreset);
  } catch {
    return [];
  }
}

function isPreset(v: unknown): v is Preset {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === "string" && typeof p.name === "string" && !!p.filters;
}

function write(presets: Preset[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(presets));
  } catch {
    // storage full / disabled — silently drop; a toast would be better once
    // we have one.
  }
}

export function savePreset(name: string, filters: Filters): Preset {
  const clean = name.trim().slice(0, 64) || "Untitled preset";
  const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const preset: Preset = {
    id,
    name: clean,
    createdAt: new Date().toISOString(),
    filters: serialize(filters),
  };
  const next = [preset, ...listPresets().filter((p) => p.name !== clean)];
  write(next);
  return preset;
}

export function deletePreset(id: string): void {
  write(listPresets().filter((p) => p.id !== id));
}

export function renamePreset(id: string, name: string): void {
  const clean = name.trim().slice(0, 64);
  if (!clean) return;
  write(
    listPresets().map((p) => (p.id === id ? { ...p, name: clean } : p)),
  );
}
