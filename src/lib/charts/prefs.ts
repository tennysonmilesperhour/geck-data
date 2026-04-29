// Client-side chart preferences. Stored in localStorage so settings survive
// page reloads but remain per-device. A later PR can layer Supabase sync on
// top; the API here doesn't change.
"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { DEFAULT_PRESET_ID, PRESETS, presetById } from "./presets";
import {
  PREFS_STORAGE_KEY,
  type ChartPrefs,
  type PageId,
} from "./types";

function buildFromPreset(presetId: string): ChartPrefs {
  const preset = presetById(presetId) ?? presetById(DEFAULT_PRESET_ID)!;
  return { pages: { ...preset.pages }, preset: preset.id };
}

// useSyncExternalStore requires getSnapshot to return a referentially stable
// value when the store hasn't changed. We cache by the raw localStorage
// string and only re-parse when it differs.
let cachedRaw: string | null | undefined = undefined;
let cachedPrefs: ChartPrefs | null = null;

function readPrefs(): ChartPrefs {
  if (typeof window === "undefined") return buildFromPreset(DEFAULT_PRESET_ID);
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (cachedPrefs !== null && raw === cachedRaw) return cachedPrefs;
    cachedRaw = raw;
    if (!raw) {
      cachedPrefs = buildFromPreset(DEFAULT_PRESET_ID);
      return cachedPrefs;
    }
    const parsed = JSON.parse(raw) as ChartPrefs;
    if (!parsed || typeof parsed !== "object" || !parsed.pages) {
      cachedPrefs = buildFromPreset(DEFAULT_PRESET_ID);
      return cachedPrefs;
    }
    cachedPrefs = parsed;
    return cachedPrefs;
  } catch {
    cachedPrefs = buildFromPreset(DEFAULT_PRESET_ID);
    return cachedPrefs;
  }
}

function writePrefs(prefs: ChartPrefs) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  // Broadcast to same-tab subscribers.
  window.dispatchEvent(new CustomEvent("geck-prefs-changed"));
}

// useSyncExternalStore gives us SSR-safe subscription to localStorage.
function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === PREFS_STORAGE_KEY) cb();
  };
  const onCustom = () => cb();
  window.addEventListener("storage", onStorage);
  window.addEventListener("geck-prefs-changed", onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("geck-prefs-changed", onCustom);
  };
}

const SERVER_SNAPSHOT: ChartPrefs = buildFromPreset(DEFAULT_PRESET_ID);

export function useChartPrefs() {
  const prefs = useSyncExternalStore(
    subscribe,
    readPrefs,
    () => SERVER_SNAPSHOT,
  );

  const applyPreset = useCallback((presetId: string) => {
    writePrefs(buildFromPreset(presetId));
  }, []);

  const toggleChart = useCallback((page: PageId, chartId: string) => {
    const current = readPrefs();
    const enabled = new Set(current.pages[page] ?? []);
    if (enabled.has(chartId)) enabled.delete(chartId);
    else enabled.add(chartId);
    writePrefs({
      pages: { ...current.pages, [page]: Array.from(enabled) },
      preset: "custom",
    });
  }, []);

  const resetAll = useCallback(() => {
    writePrefs(buildFromPreset(DEFAULT_PRESET_ID));
  }, []);

  return { prefs, applyPreset, toggleChart, resetAll };
}

// Hook for non-reactive read (e.g., one-off exports).
export function getPrefsSnapshot(): ChartPrefs {
  return readPrefs();
}

export { PRESETS, DEFAULT_PRESET_ID, presetById };

// Warm-start: ensure first-time users get the default preset written so their
// settings panel renders toggles in a meaningful state.
export function useEnsurePrefsInitialized() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem(PREFS_STORAGE_KEY)) {
      writePrefs(buildFromPreset(DEFAULT_PRESET_ID));
    }
  }, []);
}
