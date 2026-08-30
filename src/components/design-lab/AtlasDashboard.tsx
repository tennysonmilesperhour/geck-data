"use client";

import Image from "next/image";
import { useState } from "react";
import type { CSSProperties } from "react";
import {
  DESIGN_LAB_IMAGES,
  DESIGN_LAB_SNAPSHOT,
} from "./data";
import styles from "./atlas-dashboard.module.css";

type Trait = (typeof DESIGN_LAB_SNAPSHOT.traits)[number];
type TraitName = Trait["name"];

const ORBIT_POINTS = [
  { name: "Lilly White", x: 50, y: 7 },
  { name: "Axanthic", x: 82, y: 26 },
  { name: "Cappuccino", x: 82, y: 74 },
  { name: "Tri-color", x: 50, y: 93 },
  { name: "Dalmatian", x: 18, y: 74 },
  { name: "Harlequin", x: 18, y: 26 },
] as const;

const MORPH_COLORS = ["#c98252", "#7f9eb6", "#aaa27d", "#d7b36c"] as const;

const IMAGE_STRIP = [
  { src: DESIGN_LAB_IMAGES.dalmatian, label: "Dalmatian" },
  { src: DESIGN_LAB_IMAGES.lilly, label: "Lilly White" },
  { src: DESIGN_LAB_IMAGES.axanthic, label: "Axanthic" },
  { src: DESIGN_LAB_IMAGES.cappuccino, label: "Cappuccino" },
] as const;

const formatPrice = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);

function DailyCaptureChart() {
  const snapshot = DESIGN_LAB_SNAPSHOT;
  const maxValue = Math.max(...snapshot.dailyListings);
  const left = 34;
  const right = 666;
  const baseline = 180;
  const chartHeight = 142;
  const points = snapshot.dailyListings.map((value, index) => ({
    value,
    day: snapshot.days[index],
    x: left + (index * (right - left)) / (snapshot.dailyListings.length - 1),
    y: baseline - (value / maxValue) * chartHeight,
  }));
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const areaPath = `${linePath} L${right},${baseline} L${left},${baseline} Z`;

  return (
    <div className={styles.captureChart}>
      <svg viewBox="0 0 700 220" role="img" aria-labelledby="capture-chart-title capture-chart-desc">
        <title id="capture-chart-title">Daily observed listing volume from August 22 to 29</title>
        <desc id="capture-chart-desc">Eight daily values: 28, 128, 85, 84, 82, 93, 37, and 27 listings.</desc>
        {[0, 32, 64, 96, 128].map((tick) => {
          const y = baseline - (tick / maxValue) * chartHeight;
          return (
            <g key={tick}>
              <line x1={left} x2={right} y1={y} y2={y} />
              <text x="0" y={y + 4}>{tick}</text>
            </g>
          );
        })}
        <path className={styles.captureArea} d={areaPath} />
        <path className={styles.captureLine} d={linePath} />
        {points.map((point) => (
          <g className={styles.capturePoint} key={point.day}>
            <circle cx={point.x} cy={point.y} r="4" />
            <text className={styles.captureValue} x={point.x} y={point.y - 12}>{point.value}</text>
            <text className={styles.captureDay} x={point.x} y="208">Aug {point.day}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function AtlasDashboard() {
  const snapshot = DESIGN_LAB_SNAPSHOT;
  const [selectedNames, setSelectedNames] = useState<TraitName[]>([
    "Lilly White",
    "Axanthic",
    "Cappuccino",
  ]);
  const maxMedian = Math.max(...snapshot.traits.map((trait) => trait.median));
  const maxCount = Math.max(...snapshot.traits.map((trait) => trait.count));
  const maxDaily = Math.max(...snapshot.dailyListings);
  const selectedTraits = selectedNames
    .map((name) => snapshot.traits.find((trait) => trait.name === name))
    .filter((trait): trait is Trait => Boolean(trait));
  const rankedTraits = [...snapshot.traits].sort((a, b) => b.median - a.median);
  const atMaximum = selectedNames.length === 4;

  const toggleTrait = (name: TraitName) => {
    setSelectedNames((current) => {
      if (current.includes(name)) {
        return current.length > 2 ? current.filter((item) => item !== name) : current;
      }
      return current.length < 4 ? [...current, name] : current;
    });
  };

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroTitle}>
          <p className={styles.eyebrow}>Atlas / Crested gecko market evidence</p>
          <h1>Market atlas</h1>
        </div>
        <div className={styles.heroIntro}>
          <p>Compare asking-price signals, observation depth, daily capture, and archive reach in one compact analytical view.</p>
          <div>
            <span>Snapshot</span>
            <strong>{snapshot.generatedAt}</strong>
          </div>
        </div>
      </header>

      <section className={styles.metricStrip} aria-label="Market snapshot">
        <article><span>Observed window</span><strong>{snapshot.observedWindow}</strong><small>8 days</small></article>
        <article><span>Recent listings</span><strong>{snapshot.recentListings}</strong><small>public asking records</small></article>
        <article><span>Median ask</span><strong>{formatPrice(snapshot.medianAsk)}</strong><small>range {snapshot.askingRange}</small></article>
        <article><span>Sold archive</span><strong>{snapshot.soldRecords.toLocaleString()}</strong><small>{snapshot.soldWindow}</small></article>
      </section>

      <div className={styles.dashboardGrid}>
        <section className={`${styles.panel} ${styles.comparePanel}`} aria-labelledby="compare-title">
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>01 / Multi-trait comparison</p>
              <h2 id="compare-title">Compare morph signals</h2>
            </div>
            <p>Choose 2–4 traits. Orbit position is a selector only; it does not encode market value.</p>
          </header>

          <div className={styles.compareWorkspace}>
            <div className={styles.compactOrbit} aria-label="Choose morphs to compare">
              <div className={styles.orbitRings} aria-hidden="true"><span /><span /></div>
              {ORBIT_POINTS.map((point) => {
                const trait = snapshot.traits.find((item) => item.name === point.name) ?? snapshot.traits[0];
                const activeIndex = selectedNames.indexOf(trait.name);
                const active = activeIndex >= 0;
                return (
                  <button
                    key={point.name}
                    type="button"
                    className={styles.orbitNode}
                    style={{
                      "--orbit-x": `${point.x}%`,
                      "--orbit-y": `${point.y}%`,
                      "--morph-accent": active ? MORPH_COLORS[activeIndex] : "#6e6961",
                    } as CSSProperties}
                    aria-pressed={active}
                    aria-label={`${active ? "Remove" : "Add"} ${trait.name}, ${formatPrice(trait.median)} median ask, ${trait.count} observations`}
                    disabled={!active && atMaximum}
                    onClick={() => toggleTrait(trait.name)}
                  >
                    <span>{active ? String(activeIndex + 1).padStart(2, "0") : "+"}</span>
                    <strong>{trait.name}</strong>
                  </button>
                );
              })}
              <div className={styles.orbitCore} aria-hidden="true">
                <strong>{selectedNames.length}</strong>
                <span>traits held</span>
              </div>
            </div>

            <div className={styles.comparisonChart} aria-live="polite">
              <div className={styles.comparisonLegend}>
                <span>Trait</span><span>Median ask / $0–$450</span><span>Sample / 0–120</span>
              </div>
              {selectedTraits.map((trait, index) => (
                <article
                  className={styles.comparisonRow}
                  key={trait.name}
                  style={{ "--morph-accent": MORPH_COLORS[index] } as CSSProperties}
                >
                  <div className={styles.comparisonName}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{trait.name}</strong>
                  </div>
                  <div className={styles.measureBlock}>
                    <div className={styles.measureTrack}><span style={{ width: `${(trait.median / maxMedian) * 100}%` }} /></div>
                    <b>{formatPrice(trait.median)}</b>
                  </div>
                  <div className={`${styles.measureBlock} ${styles.sampleMeasure}`}>
                    <div className={styles.measureTrack}><span style={{ width: `${(trait.count / maxCount) * 100}%` }} /></div>
                    <b>n={trait.count}</b>
                  </div>
                </article>
              ))}
              <p className={styles.chartNote}>Recent public listings · {snapshot.observedWindow} · asking prices are not completed sales</p>
            </div>
          </div>
        </section>

        <aside className={`${styles.panel} ${styles.scopePanel}`} aria-labelledby="scope-title">
          <header className={styles.panelHeaderCompact}>
            <p className={styles.eyebrow}>Evidence scope</p>
            <h2 id="scope-title">Two data layers</h2>
          </header>
          <div className={styles.scopeLayers}>
            <article>
              <span>Current</span>
              <strong>564</strong>
              <p>Public listings observed across eight days. Used for the trait and coverage views on this page.</p>
              <small>Aug 22–29, 2026</small>
            </article>
            <article>
              <span>Archive</span>
              <strong>2,887</strong>
              <p>Sold records held as a separate historical layer. Not mixed into current asking-price comparisons.</p>
              <small>May 11–Jun 7, 2026</small>
            </article>
          </div>
          <p className={styles.boundaryNote}>A larger archive is not automatically more current. Each view names the layer it uses.</p>
        </aside>

        <section className={`${styles.panel} ${styles.capturePanel}`} aria-labelledby="capture-title">
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>02 / Capture trend</p>
              <h2 id="capture-title">Daily observed listings</h2>
            </div>
            <p>Eight daily points show collection coverage. The Aug 23 spike is capture volume, not evidence of demand.</p>
          </header>
          <DailyCaptureChart />
          <div className={styles.captureCells} aria-label="Exact daily observed listing counts">
            {snapshot.dailyListings.map((value, index) => (
              <div
                key={snapshot.days[index]}
                style={{ "--cell-strength": 0.12 + (value / maxDaily) * 0.68 } as CSSProperties}
              >
                <span>08.{snapshot.days[index]}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.ladderPanel}`} aria-labelledby="ladder-title">
          <header className={styles.panelHeaderCompact}>
            <p className={styles.eyebrow}>03 / All traits</p>
            <h2 id="ladder-title">Price ladder</h2>
            <p>Ranked by median asking price. Sample depth remains attached to every row.</p>
          </header>
          <div className={styles.ladderRows}>
            {rankedTraits.map((trait, index) => (
              <div className={styles.ladderRow} key={trait.name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{trait.name}</strong>
                <div><span style={{ width: `${(trait.median / maxMedian) * 100}%` }} /></div>
                <b>{formatPrice(trait.median)}</b>
                <small>n={trait.count}</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className={styles.evidenceGallery} aria-labelledby="gallery-title">
        <header>
          <div><p className={styles.eyebrow}>04 / Listing evidence</p><h2 id="gallery-title">Recent specimens</h2></div>
          <p>Representative images from recent public listings. Images provide listing context; the charts use aggregate records.</p>
        </header>
        <div>
          {IMAGE_STRIP.map((item, index) => (
            <figure key={item.label}>
              <Image src={item.src} alt={`${item.label} crested gecko from a recent listing`} fill sizes="(max-width: 700px) 50vw, 25vw" />
              <figcaption><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.label}</strong><small>Recent listing image</small></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <div><span>Atlas data boundary</span><p>Current trait figures are asking-price summaries, not completed-sale valuations. Daily totals describe observed coverage, not total market activity.</p></div>
        <div><span>Snapshot generated</span><p>{snapshot.generatedAt}</p></div>
      </footer>
    </main>
  );
}
