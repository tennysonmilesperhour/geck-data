"use client";
// Presets chip that lives on the right edge of the filter bar. Opens a
// popover with:
//   - "Save current as…" input (Enter to confirm)
//   - list of existing presets with apply + delete
//
// Storage is localStorage via src/lib/market/presets.ts — see that file for
// the upgrade path to per-user cloud presets.
import { useEffect, useMemo, useState } from "react";
import type { Filters } from "@/lib/market/types";
import {
  deletePreset,
  deserialize,
  listPresets,
  savePreset,
  type Preset,
} from "@/lib/market/presets";

export default function PresetsMenu({
  filters,
  onApply,
}: {
  filters: Filters;
  onApply: (f: Filters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [draftName, setDraftName] = useState("");

  // Re-read from localStorage whenever the popover opens so presets saved in
  // another tab show up on next click.
  useEffect(() => {
    if (open) setPresets(listPresets());
  }, [open]);

  const currentMatches = useMemo(
    () => presets.find((p) => matchesFilters(p, filters))?.name ?? null,
    [presets, filters],
  );

  function onSave() {
    const name = draftName.trim();
    if (!name) return;
    savePreset(name, filters);
    setDraftName("");
    setPresets(listPresets());
  }

  function onApplyPreset(p: Preset) {
    onApply(deserialize(p.filters));
    setOpen(false);
  }

  function onDelete(id: string) {
    deletePreset(id);
    setPresets(listPresets());
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-forest-700 bg-forest-950/60 px-3 py-1.5 text-xs text-forest-200 hover:border-forest-600"
        title="Filter presets"
      >
        <span aria-hidden>☆</span>
        <span>
          {currentMatches ? (
            <>
              <span className="text-forest-400">Preset:</span>{" "}
              <span className="text-forest-50">{currentMatches}</span>
            </>
          ) : (
            "Presets"
          )}
        </span>
        <span aria-hidden className="text-forest-500">
          ▾
        </span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-forest-700 bg-forest-900 p-2 shadow-forest-panel">
            <div className="mb-2 flex items-center justify-between px-1.5 text-[10px] uppercase tracking-wider text-forest-400">
              <span>Presets</span>
              <span>{presets.length} saved</span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSave();
              }}
              className="mb-2 flex items-center gap-1.5"
            >
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Save current as…"
                className="flex-1 rounded-md border border-forest-700 bg-forest-950 px-2 py-1.5 text-xs text-forest-100 placeholder:text-forest-500 focus:border-ready/60 focus:outline-none"
                maxLength={64}
              />
              <button
                type="submit"
                disabled={!draftName.trim()}
                className="rounded-md bg-ready/20 px-2.5 py-1.5 text-xs text-ready ring-1 ring-inset ring-ready/30 hover:bg-ready/30 disabled:opacity-40"
              >
                Save
              </button>
            </form>

            {presets.length === 0 ? (
              <p className="px-1.5 py-3 text-center text-xs text-forest-500">
                No saved presets yet. Save the current filter to reuse later.
              </p>
            ) : (
              <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                {presets.map((p) => (
                  <li key={p.id} className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-forest-850">
                    <button
                      type="button"
                      onClick={() => onApplyPreset(p)}
                      className="flex-1 text-left"
                    >
                      <div className="truncate text-sm text-forest-100">{p.name}</div>
                      <div className="truncate font-mono text-[10px] text-forest-500">
                        {summarize(p)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(p.id)}
                      className="opacity-0 transition group-hover:opacity-100"
                      title="Delete preset"
                      aria-label={`Delete preset ${p.name}`}
                    >
                      <span className="rounded px-1.5 py-0.5 text-[10px] text-forest-400 hover:bg-danger/15 hover:text-danger">
                        ✕
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// Deep-equality comparison between the active filter state and a stored
// preset — so the chip label can read "Preset: My view" when the user is
// effectively sitting on a saved preset.
function matchesFilters(p: Preset, f: Filters): boolean {
  const s = p.filters;
  if (s.timeframe !== f.timeframe) return false;
  if (s.region !== f.region) return false;
  if (s.age !== f.age) return false;
  if (s.lineage !== f.lineage) return false;

  const a = s.sources;
  const b = f.sources;
  if (a === "all" && b === "all") return true;
  if (a === "all" || b === "all") return false;
  if (a.length !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function summarize(p: Preset): string {
  const s = p.filters;
  const parts = [
    s.timeframe,
    s.region === "ALL" ? "all regions" : s.region,
    s.age === "any" ? null : s.age,
    s.lineage === "any" ? null : s.lineage,
    s.sources === "all"
      ? "all sources"
      : `${s.sources.length} source${s.sources.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.join(" · ");
}
