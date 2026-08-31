"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import type { MarketSnapshot } from "@/lib/landing/snapshot";
import { fmtInt, fmtUsd } from "@/lib/format";
import styles from "./pulse-workspace.module.css";

const SECTION_IDS = [
  "controls",
  "atlas",
  "signals",
  "opportunities",
  "indices",
  "sellers",
  "story",
  "explore",
] as const;

const METRIC_IDS = ["median", "listings", "sellers", "hottest", "coverage"] as const;

type SectionId = (typeof SECTION_IDS)[number];
type MetricId = (typeof METRIC_IDS)[number];
type PulseSummary = Pick<MarketSnapshot, "totals" | "hottest_combo" | "generated_at">;

export type PulseWorkspaceSections = Record<SectionId, ReactNode>;

type Preferences = {
  version: 2;
  preset: "overview" | "buying" | "research" | "custom";
  sectionOrder: SectionId[];
  hiddenSections: SectionId[];
  metrics: MetricId[];
};

type ModuleDefinition = {
  id: SectionId;
  label: string;
  description: string;
};

const STORAGE_KEY = "geck-inspect:pulse-preferences:v2";

const MODULES: ModuleDefinition[] = [
  { id: "controls", label: "Listing filters", description: "Narrow the comparable listings by trait pair and asking-price range." },
  { id: "atlas", label: "Atlas comparison", description: "Compare current-cycle trait-family medians and inspect the evidence boundary." },
  { id: "signals", label: "Market signals", description: "Observed combinations and recent arrival patterns." },
  { id: "opportunities", label: "Below comparisons", description: "Current-cycle listings below matched asking-price sets." },
  { id: "indices", label: "Morph indices", description: "High-volume trait families and their medians." },
  { id: "sellers", label: "Seller landscape", description: "Catalogue scale and specialization context." },
  { id: "story", label: "Market structure", description: "Longer-form views of the current dataset." },
  { id: "explore", label: "Explore further", description: "Saved views, methodology, and deeper analysis." },
];

const METRIC_LABELS: Record<MetricId, string> = {
  median: "Current-cycle median ask",
  listings: "Current-cycle listings",
  sellers: "Current-cycle sellers",
  hottest: "Leading trait pair",
  coverage: "Outside current cycle",
};

const PRESETS: Record<Exclude<Preferences["preset"], "custom">, Preferences> = {
  overview: {
    version: 2,
    preset: "overview",
    sectionOrder: [...SECTION_IDS],
    hiddenSections: [],
    metrics: ["median", "listings", "sellers", "hottest"],
  },
  buying: {
    version: 2,
    preset: "buying",
    sectionOrder: ["controls", "opportunities", "atlas", "signals", "indices", "sellers", "explore", "story"],
    hiddenSections: ["story"],
    metrics: ["median", "listings", "hottest", "coverage"],
  },
  research: {
    version: 2,
    preset: "research",
    sectionOrder: ["atlas", "indices", "signals", "sellers", "story", "controls", "opportunities", "explore"],
    hiddenSections: ["opportunities"],
    metrics: ["median", "listings", "sellers", "coverage"],
  },
};

const DEFAULT_PREFERENCES = PRESETS.overview;
const SNAPSHOT_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function isSectionId(value: unknown): value is SectionId {
  return typeof value === "string" && SECTION_IDS.includes(value as SectionId);
}

function isMetricId(value: unknown): value is MetricId {
  return typeof value === "string" && METRIC_IDS.includes(value as MetricId);
}

function readPreferences(value: string | null): Preferences | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Preferences>;
    const order = Array.isArray(parsed.sectionOrder)
      ? parsed.sectionOrder.filter(isSectionId)
      : [];
    const hidden = Array.isArray(parsed.hiddenSections)
      ? parsed.hiddenSections.filter(isSectionId)
      : [];
    const metrics = Array.isArray(parsed.metrics)
      ? parsed.metrics.filter(isMetricId)
      : [];
    if (parsed.version !== 2 || order.length !== SECTION_IDS.length || new Set(order).size !== SECTION_IDS.length || metrics.length < 2) {
      return null;
    }
    return {
      version: 2,
      preset: parsed.preset === "overview" || parsed.preset === "buying" || parsed.preset === "research" ? parsed.preset : "custom",
      sectionOrder: order,
      hiddenSections: hidden,
      metrics,
    };
  } catch {
    return null;
  }
}

function formatSnapshotDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Snapshot time unavailable";
  return SNAPSHOT_FORMATTER.format(date);
}

export default function PulseWorkspace({
  snapshot,
  sections,
}: {
  snapshot: PulseSummary;
  sections: PulseWorkspaceSections;
}) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);

  useEffect(() => {
    const saved = readPreferences(window.localStorage.getItem(STORAGE_KEY));
    if (saved) setPreferences(saved);
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences, preferencesLoaded]);

  useEffect(() => {
    if (!customizerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCustomizerOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [customizerOpen]);

  const hiddenSet = new Set(preferences.hiddenSections);
  const visibleSectionIds = preferences.sectionOrder.filter((id) => !hiddenSet.has(id));
  const moduleById = new Map(MODULES.map((module) => [module.id, module]));
  const metricCards = buildMetricCards(snapshot);

  const applyPreset = (preset: Exclude<Preferences["preset"], "custom">) => {
    setPreferences({ ...PRESETS[preset], sectionOrder: [...PRESETS[preset].sectionOrder], hiddenSections: [...PRESETS[preset].hiddenSections], metrics: [...PRESETS[preset].metrics] });
  };

  const toggleMetric = (id: MetricId) => {
    setPreferences((current) => {
      const active = current.metrics.includes(id);
      if (active && current.metrics.length <= 2) return current;
      return {
        ...current,
        preset: "custom",
        metrics: active ? current.metrics.filter((metric) => metric !== id) : [...current.metrics, id],
      };
    });
  };

  const toggleSection = (id: SectionId) => {
    setPreferences((current) => {
      const isHidden = current.hiddenSections.includes(id);
      if (!isHidden && current.hiddenSections.length >= SECTION_IDS.length - 1) return current;
      return {
        ...current,
        preset: "custom",
        hiddenSections: isHidden
          ? current.hiddenSections.filter((section) => section !== id)
          : [...current.hiddenSections, id],
      };
    });
  };

  const moveSection = (id: SectionId, direction: -1 | 1) => {
    setPreferences((current) => {
      const index = current.sectionOrder.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.sectionOrder.length) return current;
      const next = [...current.sectionOrder];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, preset: "custom", sectionOrder: next };
    });
  };

  return (
    <div className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>Pulse / Current crested gecko market</p>
          <h1>Market pulse</h1>
          <p className={styles.intro}>Fresh asking-price evidence, comparable listings, trait activity, and seller context in one configurable view.</p>
        </div>
        <div className={styles.headerActions}>
          <div>
            <span>Data snapshot</span>
            <strong>{formatSnapshotDate(snapshot.generated_at)}</strong>
          </div>
          <button type="button" onClick={() => setCustomizerOpen(true)}>
            Customize your Pulse
            <span aria-hidden>↗</span>
          </button>
          <Link href="/market">Open full market dashboard →</Link>
        </div>
      </header>

      <section className={styles.metricStrip} aria-label="Selected market metrics">
        {preferences.metrics.map((id) => {
          const metric = metricCards[id];
          return (
            <article key={id}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.context}</small>
            </article>
          );
        })}
      </section>

      <div className={styles.preferenceSummary}>
        <span>{preferences.preset === "custom" ? "Custom Pulse" : `${preferences.preset[0].toUpperCase()}${preferences.preset.slice(1)} preset`}</span>
        <p>{visibleSectionIds.length} modules · {preferences.metrics.length} headline metrics · saved on this device</p>
        <button type="button" onClick={() => setCustomizerOpen(true)}>Edit feed</button>
      </div>

      <div className={styles.modules}>
        {visibleSectionIds.map((id, index) => {
          const definition = moduleById.get(id);
          if (!definition) return null;
          return (
            <section className={styles.module} key={id} data-module={id}>
              <header className={styles.moduleRail}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><h2>{definition.label}</h2><p>{definition.description}</p></div>
              </header>
              <div className={styles.moduleContent}>{sections[id]}</div>
            </section>
          );
        })}
      </div>

      {customizerOpen ? (
        <div className={styles.customizerLayer}>
          <button className={styles.customizerBackdrop} type="button" aria-label="Dismiss Pulse customizer" onClick={() => setCustomizerOpen(false)} />
          <aside className={styles.customizer} role="dialog" aria-modal="true" aria-labelledby="customizer-title">
            <header>
              <div><p className={styles.eyebrow}>Your first page</p><h2 id="customizer-title">Customize Pulse</h2></div>
              <button type="button" onClick={() => setCustomizerOpen(false)} aria-label="Close Pulse customizer">×</button>
            </header>

            <div className={styles.customizerBody}>
              <section>
                <h3>Start with a focus</h3>
                <div className={styles.presets}>
                  {(["overview", "buying", "research"] as const).map((preset) => (
                    <button key={preset} type="button" aria-pressed={preferences.preset === preset} onClick={() => applyPreset(preset)}>
                      <strong>{preset[0].toUpperCase()}{preset.slice(1)}</strong>
                      <span>{preset === "overview" ? "Balanced market view" : preset === "buying" ? "Listings and comparisons first" : "Traits and structure first"}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3>Headline metrics</h3>
                <p>Choose at least two. These appear before the page modules.</p>
                <div className={styles.metricChoices}>
                  {METRIC_IDS.map((id) => (
                    <label key={id}>
                      <input type="checkbox" checked={preferences.metrics.includes(id)} onChange={() => toggleMetric(id)} disabled={preferences.metrics.includes(id) && preferences.metrics.length <= 2} />
                      <span>{METRIC_LABELS[id]}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section>
                <h3>Page modules</h3>
                <p>Show, hide, or move each information block.</p>
                <div className={styles.moduleChoices}>
                  {preferences.sectionOrder.map((id, index) => {
                    const definition = moduleById.get(id);
                    if (!definition) return null;
                    const visible = !hiddenSet.has(id);
                    return (
                      <div key={id}>
                        <label>
                          <input type="checkbox" checked={visible} onChange={() => toggleSection(id)} disabled={visible && visibleSectionIds.length <= 1} />
                          <span><strong>{definition.label}</strong><small>{definition.description}</small></span>
                        </label>
                        <div>
                          <button type="button" onClick={() => moveSection(id, -1)} disabled={index === 0} aria-label={`Move ${definition.label} up`}>↑</button>
                          <button type="button" onClick={() => moveSection(id, 1)} disabled={index === preferences.sectionOrder.length - 1} aria-label={`Move ${definition.label} down`}>↓</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            <footer>
              <button type="button" onClick={() => applyPreset("overview")}>Reset to overview</button>
              <button type="button" onClick={() => setCustomizerOpen(false)}>Done</button>
            </footer>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function buildMetricCards(snapshot: PulseSummary): Record<MetricId, { label: string; value: string; context: string }> {
  const { totals, hottest_combo } = snapshot;
  const currentWindow = totals.fresh_hours % 24 === 0
    ? `${totals.fresh_hours / 24} days`
    : `${totals.fresh_hours} hours`;
  return {
    median: {
      label: "Current-cycle median ask",
      value: totals.fresh_median_ask != null ? fmtUsd(totals.fresh_median_ask) : "Unavailable",
      context: totals.fresh_priced_listings != null ? `${fmtInt(totals.fresh_priced_listings)} priced ads observed in ${currentWindow}` : "current asks only",
    },
    listings: {
      label: "Current-cycle listings",
      value: fmtInt(totals.fresh_listings),
      context: `re-confirmed in the last ${currentWindow}`,
    },
    sellers: {
      label: "Current-cycle sellers",
      value: totals.fresh_sellers != null ? fmtInt(totals.fresh_sellers) : "Unavailable",
      context: "distinct sellers in the current listing sample",
    },
    hottest: {
      label: "Leading trait pair",
      value: hottest_combo?.combo_name ?? "No supported pair",
      context: hottest_combo ? `${fmtInt(hottest_combo.fresh_live_count)} current-cycle listings` : "current sample too thin",
    },
    coverage: {
      label: "Outside current cycle",
      value: fmtInt(totals.stale_listings),
      context: "kept separate from current asking metrics",
    },
  };
}
