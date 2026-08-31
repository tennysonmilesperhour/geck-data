"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { AtlasListing, AtlasMorph, AtlasSnapshot } from "./atlas-types";
import {
  buildMorphComparison,
  pairOverlap,
  type ComparisonConfidence,
  type ComparisonScope,
  type MorphComparisonMetric,
  type MorphComparisonResult,
} from "@/lib/market/morph-compare";
import { DESIGN_LAB_SNAPSHOT } from "./data";
import styles from "./atlas-dashboard.module.css";

const MAX_MORPHS = 5;
const MORPH_COLORS = ["#34d399", "#7dd3fc", "#fbbf24", "#c4b5fd", "#fb7185"] as const;
const MATURITY_OPTIONS = ["All", "Baby", "Juvenile", "Subadult", "Adult", "Unreported"];
const SEX_OPTIONS = ["All", "Male", "Female", "Unreported"];
const STORAGE_KEY = "geck-inspect:atlas-compare:v1";

type AudienceMode = "buyer" | "breeder" | "research";
type ComparisonView = "price" | "supply" | "composition" | "trend" | "evidence";
type OrbitMode = "relationship" | "price" | "availability" | "momentum";
type ListingSort = "comparable" | "price" | "newest";

type SavedState = {
  selectedNames: string[];
  audienceMode: AudienceMode;
  activeView: ComparisonView;
  orbitMode: OrbitMode;
  scope: ComparisonScope;
  maturity: string;
  sex: string;
};

const formatPrice = (value: number | null) => value === null
  ? "—"
  : new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);

const formatCount = (value: number | null) => value === null ? "—" : value.toLocaleString();
const formatPct = (value: number | null, digits = 0) => value === null
  ? "—"
  : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
const formatShare = (value: number, digits = 0) => `${value.toFixed(digits)}%`;

function isAudienceMode(value: unknown): value is AudienceMode {
  return value === "buyer" || value === "breeder" || value === "research";
}

function isComparisonView(value: unknown): value is ComparisonView {
  return value === "price" || value === "supply" || value === "composition" || value === "trend" || value === "evidence";
}

function isOrbitMode(value: unknown): value is OrbitMode {
  return value === "relationship" || value === "price" || value === "availability" || value === "momentum";
}

function isScope(value: unknown): value is ComparisonScope {
  return value === "contains" || value === "only";
}

function confidenceClass(value: ComparisonConfidence): string {
  if (value === "Strong") return styles.confidenceStrong;
  if (value === "Moderate") return styles.confidenceModerate;
  if (value === "Thin") return styles.confidenceThin;
  return styles.confidenceNone;
}

function metricColor(index: number): string {
  return MORPH_COLORS[index % MORPH_COLORS.length]!;
}

function initialMorphs(snapshot: AtlasSnapshot): string[] {
  const counts = new Map<string, number>();
  for (const listing of snapshot.listings) {
    for (const trait of listing.traits) counts.set(trait, (counts.get(trait) ?? 0) + 1);
  }
  return [...snapshot.morphs]
    .sort((a, b) => (counts.get(b.name) ?? 0) - (counts.get(a.name) ?? 0))
    .filter((morph) => (counts.get(morph.name) ?? 0) > 0)
    .slice(0, 3)
    .map((morph) => morph.name);
}

function comparisonReading(result: MorphComparisonResult): string {
  const withPrice = result.metrics.filter((metric) => metric.median !== null);
  if (result.metrics.length === 0) return "Choose at least one morph to begin the comparison.";
  if (withPrice.length === 0) return "The selected filters leave no priced listings for these morphs.";
  const priceLeader = [...withPrice].sort((a, b) => (b.median ?? 0) - (a.median ?? 0))[0]!;
  const supplyLeader = [...result.metrics].sort((a, b) => b.listingCount - a.listingCount)[0]!;
  const priceSentence = result.metrics.length === 1
    ? `${priceLeader.morph.name} has a current median ask of ${formatPrice(priceLeader.median)} across ${priceLeader.pricedCount} priced listings.`
    : `${priceLeader.morph.name} has the highest current median ask at ${formatPrice(priceLeader.median)}.`;
  const supplySentence = `${supplyLeader.morph.name} has the broadest current supply with ${supplyLeader.listingCount} listings from ${supplyLeader.sellerCount} identified sellers.`;
  const caveat = priceLeader.maturityReportedPct < 50
    ? ` Maturity is reported on only ${formatShare(priceLeader.maturityReportedPct)} of ${priceLeader.morph.name} listings, so its unfiltered price difference is not maturity-adjusted.`
    : "";
  return `${priceSentence} ${supplySentence}${caveat}`;
}

function MorphPicker({
  open,
  morphs,
  metricByName,
  selectedNames,
  onToggle,
  onClose,
}: {
  open: boolean;
  morphs: ReadonlyArray<AtlasMorph>;
  metricByName: ReadonlyMap<string, MorphComparisonMetric>;
  selectedNames: ReadonlyArray<string>;
  onToggle: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  const categories = ["all", ...new Set(morphs.map((morph) => morph.category))];
  const needle = query.trim().toLowerCase();
  const visible = morphs.filter((morph) => {
    const matchesCategory = category === "all" || morph.category === category;
    const matchesQuery = !needle || [morph.name, ...morph.aliases].some((value) => value.toLowerCase().includes(needle));
    return matchesCategory && matchesQuery;
  });

  return (
    <div className={styles.pickerBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={styles.pickerDialog} role="dialog" aria-modal="true" aria-labelledby="morph-picker-title">
        <header className={styles.pickerHeader}>
          <div>
            <span>Morph library</span>
            <h3 id="morph-picker-title">Choose up to five morphs</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close morph picker">Close</button>
        </header>
        <div className={styles.pickerSearch}>
          <label>
            <span>Search canonical names or aliases</span>
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Lilly White, pinstripe, dalmatian…" />
          </label>
          <strong>{selectedNames.length}/{MAX_MORPHS} selected</strong>
        </div>
        <div className={styles.categoryTabs} aria-label="Morph categories">
          {categories.map((value) => (
            <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}>
              {value === "all" ? "All morphs" : value}
            </button>
          ))}
        </div>
        <div className={styles.pickerList}>
          {visible.map((morph) => {
            const metric = metricByName.get(morph.name);
            const selected = selectedNames.includes(morph.name);
            const disabled = !selected && selectedNames.length >= MAX_MORPHS;
            return (
              <button
                type="button"
                key={morph.name}
                className={styles.pickerRow}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onToggle(morph.name)}
              >
                <span className={styles.pickerCheck}>{selected ? "✓" : "+"}</span>
                <span className={styles.pickerIdentity}>
                  <strong>{morph.name}</strong>
                  <small>{morph.category}{morph.aliases.length ? ` · ${morph.aliases.slice(0, 3).join(", ")}` : ""}</small>
                </span>
                <span className={styles.pickerEvidence}>
                  <b>{metric?.listingCount ?? 0} listings</b>
                  <small>{metric?.sellerCount ?? 0} sellers · {formatPrice(metric?.median ?? null)}</small>
                </span>
                <span className={`${styles.confidence} ${confidenceClass(metric?.confidence ?? "No data")}`}>
                  {metric?.confidence ?? "No data"}
                </span>
              </button>
            );
          })}
          {visible.length === 0 ? <p className={styles.emptyPicker}>No canonical morph matches that search.</p> : null}
        </div>
        <footer className={styles.pickerFooter}>
          <p>Every canonical morph remains searchable. Thin or empty current samples stay visible rather than being silently removed.</p>
          <button type="button" onClick={onClose}>Use selected morphs</button>
        </footer>
      </section>
    </div>
  );
}

function MorphOrbit({
  metrics,
  mode,
  focusedName,
  onFocus,
  onRemove,
  onAdd,
}: {
  metrics: ReadonlyArray<MorphComparisonMetric>;
  mode: OrbitMode;
  focusedName: string;
  onFocus: (name: string) => void;
  onRemove: (name: string) => void;
  onAdd: () => void;
}) {
  const values = metrics.map((metric) => {
    if (mode === "price") return metric.premiumPct ?? 0;
    if (mode === "availability") return metric.listingCount;
    if (mode === "momentum") return metric.momentumPct ?? 0;
    return 0;
  });
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(1, ...values);
  const slots = Array.from({ length: MAX_MORPHS }, (_, index) => metrics[index] ?? null);
  const points = slots.map((metric, index) => {
    const angle = -90 + index * (360 / MAX_MORPHS);
    const value = values[index] ?? 0;
    const normalized = maximum === minimum ? 0.5 : (value - minimum) / (maximum - minimum);
    const radius = mode === "relationship" ? 39 : 28 + normalized * 14;
    const radians = angle * Math.PI / 180;
    return {
      metric,
      x: 50 + Math.cos(radians) * radius,
      y: 50 + Math.sin(radians) * radius,
      value,
    };
  });
  const edges: Array<{ key: string; x1: number; y1: number; x2: number; y2: number; count: number; share: number }> = [];
  if (mode === "relationship") {
    for (let a = 0; a < metrics.length; a += 1) {
      for (let b = a + 1; b < metrics.length; b += 1) {
        const overlap = pairOverlap(metrics[a]!, metrics[b]!);
        if (overlap.count === 0) continue;
        edges.push({
          key: `${metrics[a]!.morph.name}:${metrics[b]!.morph.name}`,
          x1: points[a]!.x,
          y1: points[a]!.y,
          x2: points[b]!.x,
          y2: points[b]!.y,
          count: overlap.count,
          share: overlap.shareOfSmaller,
        });
      }
    }
  }

  const modeLabel = mode === "relationship"
    ? "co-listing overlap"
    : mode === "price"
      ? "premium vs cohort"
      : mode === "availability"
        ? "current listings"
        : "same-listing change";

  return (
    <div className={styles.orbitCanvas} aria-label={`Morph orbit showing ${modeLabel}`}>
      <div className={styles.orbitRings} aria-hidden="true"><span /><span /></div>
      <svg className={styles.orbitEdges} viewBox="0 0 100 100" aria-hidden="true">
        {edges.map((edge) => (
          <line
            key={edge.key}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            style={{ "--edge-strength": Math.min(1, 0.2 + edge.share / 80) } as CSSProperties}
            strokeWidth={Math.min(3, 0.45 + edge.share / 18)}
          />
        ))}
      </svg>
      {points.map((point, index) => {
        const color = metricColor(index);
        const metric = point.metric;
        if (!metric) {
          return (
            <button
              type="button"
              key={`empty-${index}`}
              className={`${styles.orbitNode} ${styles.emptyOrbitNode}`}
              style={{ "--orbit-x": `${point.x}%`, "--orbit-y": `${point.y}%` } as CSSProperties}
              onClick={onAdd}
            >
              <span>+</span><strong>Add morph</strong><small>Open library</small>
            </button>
          );
        }
        const value = mode === "relationship"
          ? `${metric.listingCount} listings`
          : mode === "price"
            ? formatPct(metric.premiumPct)
            : mode === "availability"
              ? `${metric.listingCount} listings`
              : `${formatPct(metric.momentumPct)} · n=${metric.momentumCount}`;
        return (
          <div
            className={styles.orbitNodeWrap}
            key={metric.morph.name}
            style={{
              "--orbit-x": `${point.x}%`,
              "--orbit-y": `${point.y}%`,
              "--morph-accent": color,
            } as CSSProperties}
          >
            <button
              type="button"
              className={styles.orbitNode}
              aria-pressed={focusedName === metric.morph.name}
              onClick={() => onFocus(metric.morph.name)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{metric.morph.name}</strong>
              <small>{value}</small>
            </button>
            <button type="button" className={styles.orbitRemove} onClick={() => onRemove(metric.morph.name)} aria-label={`Remove ${metric.morph.name}`}>×</button>
          </div>
        );
      })}
      <div className={styles.orbitCore}>
        <strong>{metrics.length}</strong>
        <span>{modeLabel}</span>
      </div>
      <p className={styles.orbitScale}>{mode === "relationship" ? "Lines show shared listings" : "Inner lower · outer higher"}</p>
    </div>
  );
}

function PriceView({ metrics, marketMedian }: { metrics: ReadonlyArray<MorphComparisonMetric>; marketMedian: number | null }) {
  const maxPrice = Math.max(1, marketMedian ?? 0, ...metrics.map((metric) => metric.p75 ?? metric.median ?? 0));
  return (
    <div className={styles.priceView}>
      <div className={styles.priceLegend}><span>Morph</span><span>Middle 50% of current asking prices</span><span>Median / cohort</span><span>Evidence</span></div>
      {metrics.map((metric, index) => {
        const left = ((metric.p25 ?? 0) / maxPrice) * 100;
        const right = ((metric.p75 ?? metric.p25 ?? 0) / maxPrice) * 100;
        const median = ((metric.median ?? 0) / maxPrice) * 100;
        return (
          <article className={styles.priceRow} key={metric.morph.name} style={{ "--morph-accent": metricColor(index) } as CSSProperties}>
            <div className={styles.rowIdentity}><span>{String(index + 1).padStart(2, "0")}</span><strong>{metric.morph.name}</strong><small>{metric.pricedCount} priced</small></div>
            <div className={styles.rangePlot} aria-label={`${metric.morph.name}: ${formatPrice(metric.p25)} to ${formatPrice(metric.p75)}, median ${formatPrice(metric.median)}`}>
              <span className={styles.marketReference} style={{ left: `${((marketMedian ?? 0) / maxPrice) * 100}%` }} />
              {metric.median !== null ? <><span className={styles.rangeLine} style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }} /><span className={styles.rangeDot} style={{ left: `${median}%` }} /></> : null}
            </div>
            <div className={styles.priceNumbers}><strong>{formatPrice(metric.median)}</strong><small>{formatPrice(metric.p25)}–{formatPrice(metric.p75)} · {formatPct(metric.premiumPct)} vs cohort</small></div>
            <div className={styles.evidenceCell}><span className={`${styles.confidence} ${confidenceClass(metric.confidence)}`}>{metric.confidence}</span><small>{metric.sellerCount} sellers</small></div>
          </article>
        );
      })}
      <p className={styles.viewFootnote}>Vertical reference = {formatPrice(marketMedian)} cohort median. Each range is P25–P75; the dot is the median.</p>
    </div>
  );
}

function SupplyView({ metrics }: { metrics: ReadonlyArray<MorphComparisonMetric> }) {
  const maximum = Math.max(1, ...metrics.map((metric) => metric.listingCount));
  return (
    <div className={styles.supplyGrid}>
      {metrics.map((metric, index) => (
        <article className={styles.supplyCard} key={metric.morph.name} style={{ "--morph-accent": metricColor(index) } as CSSProperties}>
          <header><span>{String(index + 1).padStart(2, "0")}</span><strong>{metric.morph.name}</strong><small>{formatShare(metric.marketSharePct, 1)} of filtered cohort</small></header>
          <div className={styles.supplyBar}><span style={{ width: `${(metric.listingCount / maximum) * 100}%` }} /></div>
          <dl>
            <div><dt>Current listings</dt><dd>{metric.listingCount}</dd></div>
            <div><dt>Identified sellers</dt><dd>{metric.sellerCount}</dd></div>
            <div><dt>Top seller share</dt><dd>{metric.topSellerSharePct === null ? "—" : formatShare(metric.topSellerSharePct)}</dd></div>
            <div><dt>New this cycle</dt><dd>{metric.newArrivalCount}</dd></div>
            <div><dt>Median days listed</dt><dd>{metric.medianDaysListed === null ? "—" : Math.round(metric.medianDaysListed)}</dd></div>
            <div><dt>Seller captured</dt><dd>{formatShare(metric.sellerCoveragePct)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

const MIX_COLORS = ["#34d399", "#7dd3fc", "#fbbf24", "#c4b5fd", "#475569"];

function MixBar({ slices }: { slices: MorphComparisonMetric["maturityMix"] }) {
  return (
    <div className={styles.mixBar}>
      {slices.map((slice, index) => slice.share > 0 ? (
        <span key={slice.label} style={{ width: `${slice.share}%`, background: MIX_COLORS[index % MIX_COLORS.length] }} title={`${slice.label}: ${slice.count} (${formatShare(slice.share)})`} />
      ) : null)}
    </div>
  );
}

function CompositionView({ metrics }: { metrics: ReadonlyArray<MorphComparisonMetric> }) {
  return (
    <div className={styles.compositionView}>
      <div className={styles.compositionCards}>
        {metrics.map((metric, index) => (
          <article key={metric.morph.name} style={{ "--morph-accent": metricColor(index) } as CSSProperties}>
            <header><span>{String(index + 1).padStart(2, "0")}</span><strong>{metric.morph.name}</strong></header>
            <section><div><b>Maturity mix</b><small>{formatShare(metric.maturityReportedPct)} reported</small></div><MixBar slices={metric.maturityMix} /><p>{metric.maturityMix.filter((slice) => slice.count > 0).map((slice) => `${slice.label} ${formatShare(slice.share)}`).join(" · ")}</p></section>
            <section><div><b>Sex mix</b><small>{formatShare(metric.sexReportedPct)} reported</small></div><MixBar slices={metric.sexMix} /><p>{metric.sexMix.filter((slice) => slice.count > 0).map((slice) => `${slice.label} ${formatShare(slice.share)}`).join(" · ")}</p></section>
            <section><div><b>Common companion traits</b><small>share of morph listings</small></div>
              {metric.coTraits.length ? <ul>{metric.coTraits.map((trait) => <li key={trait.name}><span>{trait.name}</span><b>{formatShare(trait.share)}</b></li>)}</ul> : <p>No co-traits in this filtered sample.</p>}
            </section>
          </article>
        ))}
      </div>
      <div className={styles.overlapMatrix}>
        <h4>Selected morph overlap</h4>
        <div className={styles.matrixScroller}>
          <table>
            <thead><tr><th>Morph</th>{metrics.map((metric, index) => <th key={metric.morph.name}><span style={{ background: metricColor(index) }} />{metric.morph.name}</th>)}</tr></thead>
            <tbody>{metrics.map((rowMetric, rowIndex) => <tr key={rowMetric.morph.name}><th><span style={{ background: metricColor(rowIndex) }} />{rowMetric.morph.name}</th>{metrics.map((columnMetric, columnIndex) => {
              const overlap = rowIndex === columnIndex ? null : pairOverlap(rowMetric, columnMetric);
              return <td key={columnMetric.morph.name}>{overlap ? <><strong>{overlap.count}</strong><small>{formatShare(overlap.shareOfSmaller)} of smaller set</small></> : <><strong>{rowMetric.listingCount}</strong><small>own listings</small></>}</td>;
            })}</tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TrendView({ metrics, dates }: { metrics: ReadonlyArray<MorphComparisonMetric>; dates: ReadonlyArray<string> }) {
  const values = metrics.flatMap((metric) => metric.trend.map((point) => point.median).filter((value): value is number => value !== null));
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 1);
  const left = 52;
  const right = 728;
  const top = 24;
  const bottom = 210;
  const y = (value: number) => bottom - ((value - minimum) / Math.max(1, maximum - minimum)) * (bottom - top);
  const x = (index: number) => left + (index / Math.max(1, dates.length - 1)) * (right - left);
  const ticks = [minimum, minimum + (maximum - minimum) / 2, maximum];
  return (
    <div className={styles.trendView}>
      <div className={styles.trendChart}>
        <svg viewBox="0 0 780 250" role="img" aria-labelledby="morph-trend-title morph-trend-desc">
          <title id="morph-trend-title">Daily median asking price by selected morph</title>
          <desc id="morph-trend-desc">Eight-day asking-price observations for current listings matching the selected filters.</desc>
          {ticks.map((tick) => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} /><text x="0" y={y(tick) + 4}>{formatPrice(tick)}</text></g>)}
          {dates.map((date, index) => <text className={styles.trendDate} key={date} x={x(index)} y="240">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}</text>)}
          {metrics.map((metric, metricIndex) => {
            let path = "";
            let previousAvailable = false;
            metric.trend.forEach((point, pointIndex) => {
              if (point.median === null) { previousAvailable = false; return; }
              path += `${previousAvailable ? "L" : "M"}${x(pointIndex)},${y(point.median)} `;
              previousAvailable = true;
            });
            return <g key={metric.morph.name} style={{ "--morph-accent": metricColor(metricIndex) } as CSSProperties}><path className={styles.trendLine} d={path} />{metric.trend.map((point, pointIndex) => point.median === null ? null : <circle className={styles.trendPoint} key={point.date} cx={x(pointIndex)} cy={y(point.median)} r="3"><title>{metric.morph.name} · {point.date} · {formatPrice(point.median)} · n={point.count}</title></circle>)}</g>;
          })}
        </svg>
      </div>
      <div className={styles.trendCards}>
        {metrics.map((metric, index) => <article key={metric.morph.name} style={{ "--morph-accent": metricColor(index) } as CSSProperties}><span>{String(index + 1).padStart(2, "0")}</span><strong>{metric.morph.name}</strong><b>{formatPct(metric.momentumPct, 1)}</b><small>median same-listing ask change · n={metric.momentumCount} · {metric.observedDays}/{dates.length} observed days</small></article>)}
      </div>
      <p className={styles.viewFootnote}>The line is the daily median ask among currently live matching listings. Momentum compares each listing’s first and last recorded ask, so collection volume is not mislabeled as demand.</p>
    </div>
  );
}

function EvidenceView({ comparison, snapshot }: { comparison: MorphComparisonResult; snapshot: AtlasSnapshot }) {
  const { metrics } = comparison;
  return (
    <div className={styles.evidenceView}>
      <div className={styles.evidenceTableWrap}><table><thead><tr><th>Morph</th><th>Confidence</th><th>Priced listings</th><th>Sellers</th><th>Maturity reported</th><th>Sex reported</th><th>Observed days</th></tr></thead><tbody>{metrics.map((metric, index) => <tr key={metric.morph.name}><th><span style={{ background: metricColor(index) }} />{metric.morph.name}</th><td><span className={`${styles.confidence} ${confidenceClass(metric.confidence)}`}>{metric.confidence}</span></td><td>{metric.pricedCount}</td><td>{metric.sellerCount}</td><td>{formatShare(metric.maturityReportedPct)}</td><td>{formatShare(metric.sexReportedPct)}</td><td>{metric.observedDays}/{snapshot.observedWindowDays}</td></tr>)}</tbody></table></div>
      <div className={styles.evidenceNotes}>
        <article><span>Current comparison population</span><strong>{formatCount(comparison.cohortCount)}</strong><p>After the selected scope. {comparison.traitResolvedCount} of {comparison.filteredListingCount} maturity/sex-filtered listings resolve to at least one canonical trait ({formatShare(comparison.traitCoveragePct)}).</p></article>
        <article><span>Captured sold events</span><strong>{formatCount(snapshot.capturedSold.count)}</strong><p>{snapshot.capturedSold.window}. Kept outside the current comparison because the sold stream is not continuous enough for live demand claims.</p></article>
        <article><span>Inferred sold records</span><strong>{formatCount(snapshot.inferredSold.count)}</strong><p>{snapshot.inferredSold.window}. Disappearance is not proof of sale, so these records never become sell-through.</p></article>
      </div>
    </div>
  );
}

function ListingCard({ listing }: { listing: AtlasListing }) {
  return (
    <article className={styles.listingCard}>
      <Link href={`/listings/${listing.id}`} className={styles.listingImage} aria-label={`Open ${listing.title}`}>
        {listing.imageUrl ? <Image src={listing.imageUrl} alt={`${listing.title} crested gecko`} fill sizes="(max-width: 700px) 88vw, 240px" /> : <span>No listing image</span>}
      </Link>
      <div className={styles.listingBody}>
        <div><span>{listing.maturity ?? "Maturity unreported"} · {listing.sex ?? "sex unreported"}</span><strong>{formatPrice(listing.price)}</strong></div>
        <Link href={`/listings/${listing.id}`}>{listing.title}</Link>
        <p>{listing.traits.slice(0, 4).join(" · ") || "No canonical traits resolved"}</p>
        <small>{listing.sellerId ? `Seller ${listing.sellerId}` : "Seller unreported"}</small>
      </div>
    </article>
  );
}

export default function AtlasDashboard({
  snapshot = DESIGN_LAB_SNAPSHOT,
  production = false,
  compact = false,
}: {
  snapshot?: AtlasSnapshot;
  production?: boolean;
  compact?: boolean;
}) {
  const defaultNames = useMemo(() => initialMorphs(snapshot), [snapshot]);
  const [selectedNames, setSelectedNames] = useState<string[]>(defaultNames);
  const [focusedName, setFocusedName] = useState(defaultNames[0] ?? "");
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("buyer");
  const [activeView, setActiveView] = useState<ComparisonView>("price");
  const [orbitMode, setOrbitMode] = useState<OrbitMode>("relationship");
  const [scope, setScope] = useState<ComparisonScope>("contains");
  const [maturity, setMaturity] = useState("All");
  const [sex, setSex] = useState("All");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [listingSort, setListingSort] = useState<ListingSort>("comparable");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const observationDates = useMemo(() => snapshot.dailyObservations.map((day) => day.date), [snapshot.dailyObservations]);

  useEffect(() => {
    const available = new Set(snapshot.morphs.map((morph) => morph.name));
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<SavedState> | null;
      if (saved) {
        const names = Array.isArray(saved.selectedNames) ? saved.selectedNames.filter((name): name is string => typeof name === "string" && available.has(name)).slice(0, MAX_MORPHS) : [];
        if (names.length) { setSelectedNames(names); setFocusedName(names[0]!); }
        if (isAudienceMode(saved.audienceMode)) setAudienceMode(saved.audienceMode);
        if (isComparisonView(saved.activeView)) setActiveView(saved.activeView);
        if (isOrbitMode(saved.orbitMode)) setOrbitMode(saved.orbitMode);
        if (isScope(saved.scope)) setScope(saved.scope);
        if (typeof saved.maturity === "string" && MATURITY_OPTIONS.includes(saved.maturity)) setMaturity(saved.maturity);
        if (typeof saved.sex === "string" && SEX_OPTIONS.includes(saved.sex)) setSex(saved.sex);
      }
    } catch {
      // A malformed local preference should never block the live comparison.
    }
    setPreferencesLoaded(true);
  }, [snapshot.morphs]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const value: SavedState = { selectedNames, audienceMode, activeView, orbitMode, scope, maturity, sex };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }, [selectedNames, audienceMode, activeView, orbitMode, scope, maturity, sex, preferencesLoaded]);

  const filters = useMemo(() => ({ scope, maturity, sex }), [scope, maturity, sex]);
  const allMorphResult = useMemo(() => buildMorphComparison(
    snapshot.morphs,
    snapshot.morphs.map((morph) => morph.name),
    snapshot.listings,
    snapshot.priceObservations,
    filters,
    snapshot.generatedAtIso,
    snapshot.currentWindowHours,
    observationDates,
  ), [snapshot, filters, observationDates]);
  const metricByName = useMemo(() => new Map(allMorphResult.metrics.map((metric) => [metric.morph.name, metric])), [allMorphResult.metrics]);
  const comparison = useMemo(() => ({
    ...allMorphResult,
    metrics: selectedNames.map((name) => metricByName.get(name)).filter((metric): metric is MorphComparisonMetric => Boolean(metric)),
  }), [allMorphResult, metricByName, selectedNames]);

  const effectiveFocusedName = selectedNames.includes(focusedName) ? focusedName : selectedNames[0] ?? "";
  const focusedMetric = comparison.metrics.find((metric) => metric.morph.name === effectiveFocusedName) ?? comparison.metrics[0] ?? null;
  const matchingListings = useMemo(() => {
    if (!focusedMetric) return [];
    const rows = snapshot.listings.filter((listing) => focusedMetric.listingIds.has(listing.id));
    const median = focusedMetric.median;
    return rows.sort((a, b) => {
      if (listingSort === "price") return (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER);
      if (listingSort === "newest") return (b.firstListedAt ?? b.firstSeenAt ?? "").localeCompare(a.firstListedAt ?? a.firstSeenAt ?? "");
      return Math.abs((a.price ?? Number.MAX_SAFE_INTEGER) - (median ?? 0)) - Math.abs((b.price ?? Number.MAX_SAFE_INTEGER) - (median ?? 0));
    }).slice(0, 8);
  }, [focusedMetric, listingSort, snapshot.listings]);

  const toggleMorph = useCallback((name: string) => {
    setSelectedNames((current) => {
      if (current.includes(name)) {
        const next = current.filter((item) => item !== name);
        setFocusedName((focused) => focused === name ? next[0] ?? "" : focused);
        return next;
      }
      if (current.length >= MAX_MORPHS) return current;
      setFocusedName(name);
      return [...current, name];
    });
  }, []);

  const chooseAudience = useCallback((mode: AudienceMode) => {
    setAudienceMode(mode);
    if (mode === "buyer") setActiveView("price");
    if (mode === "breeder") setActiveView("supply");
    if (mode === "research") setActiveView("trend");
  }, []);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  return (
    <div className={`${styles.page} ${production ? styles.production : ""} ${compact ? styles.compact : ""}`}>
      <section className={styles.compareShell} aria-labelledby="compare-title">
        <header className={styles.compareHeader}>
          <div>
            <span className={styles.eyebrow}>Morph comparison</span>
            <h2 id="compare-title">Compare market signals</h2>
            <p>Choose up to five canonical morphs and compare price range, availability, seller breadth, composition, and observed asking-price changes.</p>
          </div>
          <div className={styles.headerControls}>
            <div className={styles.modeSwitch} aria-label="Comparison audience">
              {(["buyer", "breeder", "research"] as AudienceMode[]).map((mode) => <button key={mode} type="button" aria-pressed={audienceMode === mode} onClick={() => chooseAudience(mode)}>{mode}</button>)}
            </div>
            <button type="button" className={styles.libraryButton} onClick={openPicker}>Choose morphs <span>{selectedNames.length}/{MAX_MORPHS}</span></button>
          </div>
        </header>

        <div className={styles.filterBar}>
          <label><span>Listing scope</span><select value={scope} onChange={(event) => setScope(event.target.value as ComparisonScope)}><option value="contains">Contains morph</option><option value="only">Morph appears alone</option></select></label>
          <label><span>Maturity</span><select value={maturity} onChange={(event) => setMaturity(event.target.value)}>{MATURITY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label><span>Sex</span><select value={sex} onChange={(event) => setSex(event.target.value)}>{SEX_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
          <div className={styles.filterSummary}><strong>{comparison.cohortCount}</strong><span>listings in filtered cohort</span><small>{comparison.cohortPricedCount} priced · median {formatPrice(comparison.marketMedian)} · {formatShare(comparison.traitCoveragePct)} trait-coded</small></div>
          <p>{scope === "contains" ? "A listing can count for more than one selected morph. Overlap is shown explicitly." : "Only listings with one resolved canonical trait are included; thin samples are expected."}</p>
        </div>

        <div className={styles.primaryGrid}>
          <aside className={styles.orbitPanel}>
            <div className={styles.orbitModeSwitch} aria-label="Orbit measurement">
              {(["relationship", "price", "availability", "momentum"] as OrbitMode[]).map((mode) => <button key={mode} type="button" aria-pressed={orbitMode === mode} onClick={() => setOrbitMode(mode)}>{mode}</button>)}
            </div>
            <MorphOrbit metrics={comparison.metrics} mode={orbitMode} focusedName={focusedMetric?.morph.name ?? ""} onFocus={setFocusedName} onRemove={toggleMorph} onAdd={openPicker} />
          </aside>

          <section className={styles.comparisonPanel}>
            <div className={styles.viewTabs} role="tablist" aria-label="Morph comparison views">
              {(["price", "supply", "composition", "trend", "evidence"] as ComparisonView[]).map((view) => <button key={view} type="button" role="tab" aria-selected={activeView === view} onClick={() => setActiveView(view)}>{view === "price" ? "Price range" : view}</button>)}
            </div>
            <div className={styles.viewBody}>
              {comparison.metrics.length === 0 ? <div className={styles.emptyComparison}><strong>No morphs selected</strong><p>Open the morph library and choose up to five.</p><button type="button" onClick={openPicker}>Choose morphs</button></div> : null}
              {comparison.metrics.length > 0 && activeView === "price" ? <PriceView metrics={comparison.metrics} marketMedian={comparison.marketMedian} /> : null}
              {comparison.metrics.length > 0 && activeView === "supply" ? <SupplyView metrics={comparison.metrics} /> : null}
              {comparison.metrics.length > 0 && activeView === "composition" ? <CompositionView metrics={comparison.metrics} /> : null}
              {comparison.metrics.length > 0 && activeView === "trend" ? <TrendView metrics={comparison.metrics} dates={observationDates} /> : null}
              {comparison.metrics.length > 0 && activeView === "evidence" ? <EvidenceView comparison={comparison} snapshot={snapshot} /> : null}
            </div>
          </section>
        </div>

        <div className={styles.comparisonReading}>
          <span>Current comparison</span><p>{comparisonReading(comparison)}</p><small>Asking prices are not completed sales or a prediction of value.</small>
        </div>

        {focusedMetric ? <section className={styles.matchesSection} aria-labelledby="matching-listings-title">
          <header>
            <div><span className={styles.eyebrow}>Current listing evidence</span><h3 id="matching-listings-title">Listings containing {focusedMetric.morph.name}</h3></div>
            <div className={styles.matchControls}>
              <div>{comparison.metrics.map((metric, index) => <button key={metric.morph.name} type="button" aria-pressed={focusedMetric.morph.name === metric.morph.name} style={{ "--morph-accent": metricColor(index) } as CSSProperties} onClick={() => setFocusedName(metric.morph.name)}>{metric.morph.name}</button>)}</div>
              <label><span>Sort</span><select value={listingSort} onChange={(event) => setListingSort(event.target.value as ListingSort)}><option value="comparable">Closest to median</option><option value="price">Lowest ask</option><option value="newest">Newest listing</option></select></label>
            </div>
          </header>
          {matchingListings.length > 0 ? <div className={styles.listingGrid}>{matchingListings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}</div> : <p className={styles.emptyMatches}>No current listing matches the selected morph and filters.</p>}
        </section> : null}

        <footer className={styles.scopeFooter}>
          <div><span>Current cohort</span><strong>{snapshot.observedWindow}</strong><small>{snapshot.recentListings} fixed-price single-animal listings · newest {snapshot.latestObservationNote.replace("newest observation ", "")}</small></div>
          <div><span>Historical signal</span><strong>{snapshot.observedWindowDays} observed days</strong><small>same-listing asks only · collection volume is not demand</small></div>
          <div><span>Sales boundary</span><strong>Not scored</strong><small>captured and inferred sold pools remain separate and historical</small></div>
          <Link href="/status">Review data status →</Link>
        </footer>
      </section>

      <MorphPicker open={pickerOpen} morphs={snapshot.morphs} metricByName={metricByName} selectedNames={selectedNames} onToggle={toggleMorph} onClose={closePicker} />
    </div>
  );
}
