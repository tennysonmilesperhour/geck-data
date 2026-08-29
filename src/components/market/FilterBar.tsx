"use client";
// Top-of-page filter row.
//
//   [timeframe]   [region]   [age]   [lineage]   [sources]
//
// Only timeframe actually reaches the queries. Region, age, lineage and
// sources were never wired into the RPCs: they changed the label and, for
// sources, the attribution badge, while every widget kept returning the same
// population. A control that confirms a filter it did not apply is worse than
// no control at all, so those four are rendered disabled with the measured
// reason they cannot work yet. Re-enable one only when its query actually
// narrows the rows AND the displayed n moves with it.
//
// Coverage measured on production 2026-08-29:
//   seller_location present on 1,572 of 10,239 rows (15%)
//   maturity present on 1,277 of 10,239 rows (12%)
//   lineage: no populated source
//   sources: two values exist in the data, 'scraper' and 'manual', against
//            the eight this control offers
import { useState } from "react";
import type {
  Age,
  Filters,
  Lineage,
  Region,
  SourceId,
  Timeframe,
} from "@/lib/market/types";
import { AGES, LINEAGES, REGIONS, TIMEFRAMES } from "@/lib/market/types";
import { ALL_SOURCE_IDS, sourceMeta } from "@/lib/market/sources";
import SourceBadge from "./SourceBadge";
import PresetsMenu from "./PresetsMenu";

const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "6mo": "6 months",
  "12mo": "12 months",
  "24mo": "24 months",
};

const REGION_LABEL: Record<Region, string> = {
  ALL: "All regions",
  US: "US",
  EU: "EU",
  UK: "UK",
  CA: "CA",
  AU: "AU",
  JP: "JP",
  SE: "SE",
  SEA: "SEA",
};

export default function FilterBar({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
}) {
  return (
    <div className="forest-surface-soft flex flex-wrap items-center gap-2 p-2">
      <Segmented
        value={filters.timeframe}
        options={TIMEFRAMES}
        labelOf={(v) => TIMEFRAME_LABEL[v]}
        onChange={(v) => onChange({ ...filters, timeframe: v })}
      />

      <Chip
        icon="🌐"
        label={REGION_LABEL[filters.region]}
        title="Region"
        options={REGIONS.map((r) => ({ value: r, label: REGION_LABEL[r] }))}
        value={filters.region}
        onChange={(v) => onChange({ ...filters, region: v as Region })}
        disabledReason="Only 15% of listings carry a seller location, and the mapped rows are almost all US, so a regional split would describe the gaps rather than the market."
      />

      <Chip
        label={
          <>
            <span className="text-forest-400">Age:</span>{" "}
            <span className="text-forest-50 capitalize">{filters.age}</span>
          </>
        }
        title="Age"
        options={AGES.map((a) => ({
          value: a,
          label: a === "any" ? "Any" : a.replace("_", " "),
        }))}
        value={filters.age}
        onChange={(v) => onChange({ ...filters, age: v as Age })}
        disabledReason="Only 12% of listings report maturity, so filtering on it would silently drop the other 88%."
      />

      <Chip
        label={
          <>
            <span className="text-forest-400">Lineage:</span>{" "}
            <span className="text-forest-50 capitalize">
              {filters.lineage.replace("_", " ")}
            </span>
          </>
        }
        title="Lineage"
        options={LINEAGES.map((l) => ({
          value: l,
          label: l === "any" ? "Any" : l.replace("_", " "),
        }))}
        value={filters.lineage}
        onChange={(v) => onChange({ ...filters, lineage: v as Lineage })}
        disabledReason="No lineage data is collected yet."
      />

      <SourcesControl
        value={filters.sources}
        onChange={(v) => onChange({ ...filters, sources: v })}
        disabledReason="One feed is active. Selecting sources changed the badge, not the rows."
      />

      <div className="ml-auto">
        <PresetsMenu filters={filters} onApply={onChange} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Segmented control — used for the timeframe selector.
// ----------------------------------------------------------------------------
function Segmented<T extends string>({
  value,
  options,
  onChange,
  labelOf,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  labelOf: (v: T) => string;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-forest-700 bg-forest-950/60 text-xs">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 transition ${
              active
                ? "bg-ready/20 text-ready shadow-[inset_0_0_0_1px_rgba(123,191,131,0.25)]"
                : "text-forest-300 hover:bg-forest-850 hover:text-forest-100"
            }`}
          >
            {labelOf(opt)}
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Chip — label + native select, styled to read as a pill.
// ----------------------------------------------------------------------------
function Chip<T extends string>({
  label,
  icon,
  title,
  value,
  options,
  onChange,
  disabledReason,
}: {
  label: React.ReactNode;
  icon?: string;
  title: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: string) => void;
  disabledReason?: string;
}) {
  if (disabledReason) {
    return (
      <span
        className="relative inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-forest-800 bg-forest-950/30 px-3 py-1.5 text-xs text-forest-600 line-through decoration-forest-700"
        title={`${title} is unavailable. ${disabledReason}`}
        aria-disabled="true"
      >
        {icon ? <span aria-hidden>{icon}</span> : null}
        <span>{label}</span>
      </span>
    );
  }
  return (
    <label
      className="relative inline-flex items-center gap-1.5 rounded-lg border border-forest-700 bg-forest-950/60 px-3 py-1.5 text-xs text-forest-200 hover:border-forest-600"
      title={title}
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      <span>{label}</span>
      <span aria-hidden className="text-forest-500">
        ▾
      </span>
      <select
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ----------------------------------------------------------------------------
// SourcesControl — popover checklist of source badges. Closed state shows a
// compact summary ("All sources" / "3 sources"). Open state is a vertical
// list of every source with a checkbox toggle.
// ----------------------------------------------------------------------------
function SourcesControl({
  value,
  onChange,
  disabledReason,
}: {
  value: Set<SourceId> | "all";
  onChange: (v: Set<SourceId> | "all") => void;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);

  if (disabledReason) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-forest-800 bg-forest-950/30 px-3 py-1.5 text-xs text-forest-600 line-through decoration-forest-700"
        title={`Sources filter is unavailable. ${disabledReason}`}
        aria-disabled="true"
      >
        Sources
      </span>
    );
  }

  const activeCount = value === "all" ? ALL_SOURCE_IDS.length : value.size;
  const allLabel =
    value === "all"
      ? "All sources"
      : activeCount === 0
      ? "No sources"
      : `${activeCount} source${activeCount === 1 ? "" : "s"}`;

  function toggle(id: SourceId) {
    if (value === "all") {
      const next = new Set<SourceId>(ALL_SOURCE_IDS);
      next.delete(id);
      onChange(next);
      return;
    }
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next.size === ALL_SOURCE_IDS.length ? "all" : next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-forest-700 bg-forest-950/60 px-3 py-1.5 text-xs text-forest-200 hover:border-forest-600"
      >
        <span aria-hidden>⚙</span>
        <span>{allLabel}</span>
        <span aria-hidden className="text-forest-500">
          ▾
        </span>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-2 w-64 rounded-lg border border-forest-700 bg-forest-900 p-2 shadow-forest-panel">
            <div className="mb-2 flex items-center justify-between px-1.5 text-[10px] uppercase tracking-wider text-forest-400">
              <span>Sources</span>
              <button
                type="button"
                className="text-forest-300 hover:text-forest-100"
                onClick={() => onChange("all")}
              >
                Reset
              </button>
            </div>
            <ul className="space-y-1">
              {ALL_SOURCE_IDS.map((id) => {
                const meta = sourceMeta(id);
                const checked = value === "all" ? true : value.has(id);
                return (
                  <li key={id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-forest-850">
                      <input
                        type="checkbox"
                        className="accent-ready"
                        checked={checked}
                        onChange={() => toggle(id)}
                      />
                      <SourceBadge id={id} size="sm" />
                      <span className="ml-auto text-[10px] text-forest-500">
                        {meta.kind}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
