"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { CSSProperties } from "react";
import type {
  AtlasObservationDay,
  AtlasSnapshot,
  AtlasTrait,
} from "./atlas-types";
import { DESIGN_LAB_SNAPSHOT } from "./data";
import styles from "./atlas-dashboard.module.css";

const ORBIT_POINTS = [
  { x: 50, y: 7 },
  { x: 82, y: 26 },
  { x: 82, y: 74 },
  { x: 50, y: 93 },
  { x: 18, y: 74 },
  { x: 18, y: 26 },
] as const;

const MORPH_COLORS = ["#34d399", "#7f9eb6", "#aaa27d", "#fbbf24"] as const;

const formatPrice = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);

const formatCount = (value: number | null) =>
  value === null ? "—" : value.toLocaleString();

function DailyCaptureChart({ days }: { days: ReadonlyArray<AtlasObservationDay> }) {
  const maxValue = Math.max(1, ...days.map((day) => day.count));
  const left = 34;
  const right = 666;
  const baseline = 180;
  const chartHeight = 142;
  const divisor = Math.max(1, days.length - 1);
  const points = days.map((day, index) => ({
    ...day,
    x: left + (index * (right - left)) / divisor,
    y: baseline - (day.count / maxValue) * chartHeight,
  }));
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const areaPath = points.length > 0
    ? `${linePath} L${points.at(-1)!.x},${baseline} L${points[0]!.x},${baseline} Z`
    : "";
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((share) => Math.round(maxValue * share)))];

  return (
    <div className={styles.captureChart}>
      <svg viewBox="0 0 700 220" role="img" aria-labelledby="capture-chart-title capture-chart-desc">
        <title id="capture-chart-title">Daily unique listing observations</title>
        <desc id="capture-chart-desc">
          {days.map((day) => `${day.label}: ${day.count}`).join("; ")}.
        </desc>
        {ticks.map((tick) => {
          const y = baseline - (tick / maxValue) * chartHeight;
          return (
            <g key={tick}>
              <line x1={left} x2={right} y1={y} y2={y} />
              <text x="0" y={y + 4}>{tick}</text>
            </g>
          );
        })}
        {areaPath ? <path className={styles.captureArea} d={areaPath} /> : null}
        {linePath ? <path className={styles.captureLine} d={linePath} /> : null}
        {points.map((point) => (
          <g className={styles.capturePoint} key={point.date}>
            <circle cx={point.x} cy={point.y} r="4" />
            <text className={styles.captureValue} x={point.x} y={point.y - 12}>{point.count}</text>
            <text className={styles.captureDay} x={point.x} y="208">{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
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
  const traits = snapshot.traits.slice(0, ORBIT_POINTS.length);
  const [selectedNames, setSelectedNames] = useState<string[]>(() =>
    traits.slice(0, Math.min(3, traits.length)).map((trait) => trait.name),
  );
  const [supportingEvidenceOpen, setSupportingEvidenceOpen] = useState(false);
  const maxMedian = Math.max(1, ...traits.map((trait) => trait.median));
  const maxCount = Math.max(1, ...traits.map((trait) => trait.count));
  const maxDaily = Math.max(1, ...snapshot.dailyObservations.map((day) => day.count));
  const selectedTraits = selectedNames
    .map((name) => traits.find((trait) => trait.name === name))
    .filter((trait): trait is AtlasTrait => Boolean(trait));
  const rankedTraits = [...traits].sort((a, b) => b.median - a.median);
  const atMaximum = selectedNames.length === 4;

  const toggleTrait = (name: string) => {
    setSelectedNames((current) => {
      if (current.includes(name)) {
        return current.length > 2 ? current.filter((item) => item !== name) : current;
      }
      return current.length < 4 ? [...current, name] : current;
    });
  };

  return (
    <div className={`${styles.page} ${production ? styles.production : ""} ${compact ? styles.compact : ""}`}>
      {!compact ? <header className={styles.hero}>
        <div className={styles.heroTitle}>
          <p className={styles.eyebrow}>Atlas / Crested gecko market evidence</p>
          <h1>Market atlas</h1>
        </div>
        <div className={styles.heroIntro}>
          <p>Compare current asking-price signals, capture coverage, and dated sales evidence without mixing the underlying data layers.</p>
          <div>
            <span>Snapshot</span>
            <strong>{snapshot.generatedAt}</strong>
          </div>
        </div>
      </header> : null}

      {!compact ? <section className={styles.metricStrip} aria-label="Market snapshot">
        <article><span>Observed window</span><strong>{snapshot.observedWindow}</strong><small>{snapshot.observedWindowDays} UTC days</small></article>
        <article><span>Recently confirmed</span><strong>{formatCount(snapshot.recentListings)}</strong><small>live rows seen in 48 hours</small></article>
        <article><span>Median ask</span><strong>{snapshot.medianAsk === null ? "—" : formatPrice(snapshot.medianAsk)}</strong><small>{snapshot.askingRangeNote}</small></article>
        <article><span>Captured sold events</span><strong>{formatCount(snapshot.capturedSold.count)}</strong><small>{snapshot.capturedSold.window}</small></article>
      </section> : null}

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
              {traits.map((trait, index) => {
                const point = ORBIT_POINTS[index]!;
                const activeIndex = selectedNames.indexOf(trait.name);
                const active = activeIndex >= 0;
                return (
                  <button
                    key={trait.name}
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
                <span>Trait</span><span>Median ask / relative scale</span><span>Fresh sample</span>
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
              <p className={styles.chartNote}>Single-animal, fixed-price public listings · confirmed in 48 hours · asks are not completed sales</p>
            </div>
          </div>
        </section>

        <aside className={`${styles.panel} ${styles.scopePanel}`} aria-labelledby="scope-title">
          <header className={styles.panelHeaderCompact}>
            <p className={styles.eyebrow}>Evidence scope</p>
            <h2 id="scope-title">Three data layers</h2>
          </header>
          <div className={styles.scopeLayers}>
            <article>
              <span>Current asks</span>
              <strong>{formatCount(snapshot.recentListings)}</strong>
              <p>Live catalogue rows re-confirmed in the last 48 hours. Used for the trait comparisons on this page.</p>
              <small>{snapshot.latestObservationNote}</small>
            </article>
            <article>
              <span>Captured sold events</span>
              <strong>{formatCount(snapshot.capturedSold.count)}</strong>
              <p>Explicit sold status events. This is the smaller, directly observed historical pool.</p>
              <small>{snapshot.capturedSold.window}</small>
            </article>
            <article>
              <span>Inferred sold records</span>
              <strong>{formatCount(snapshot.inferredSold.count)}</strong>
              <p>Listings inferred sold after disappearing. Kept separate from captured events.</p>
              <small>{snapshot.inferredSold.window}</small>
            </article>
          </div>
          <p className={styles.boundaryNote}>The two sale pools are not added together. Different evidence methods remain visible as different numbers.</p>
        </aside>

        {!compact ? <section className={`${styles.panel} ${styles.capturePanel}`} aria-labelledby="capture-title">
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>02 / Capture trend</p>
              <h2 id="capture-title">Daily observed listings</h2>
            </div>
            <p>Each point counts unique listings with a price observation that day. Spikes describe collection volume, not demand.</p>
          </header>
          {snapshot.dailyObservations.length > 0 ? (
            <>
              <DailyCaptureChart days={snapshot.dailyObservations} />
              <div className={styles.captureCells} aria-label="Exact daily observed listing counts">
                {snapshot.dailyObservations.map((day) => (
                  <div
                    key={day.date}
                    style={{ "--cell-strength": 0.12 + (day.count / maxDaily) * 0.68 } as CSSProperties}
                  >
                    <span>{day.label}</span>
                    <strong>{day.count}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className={styles.emptyCapture}>Daily observation coverage was unavailable for this snapshot.</p>
          )}
        </section> : null}

        {!compact ? <section className={`${styles.panel} ${styles.ladderPanel}`} aria-labelledby="ladder-title">
          <header className={styles.panelHeaderCompact}>
            <p className={styles.eyebrow}>03 / Current traits</p>
            <h2 id="ladder-title">Price ladder</h2>
            <p>Ranked by median asking price. Fresh sample depth remains attached to every row.</p>
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
        </section> : null}
      </div>

      {compact ? (
        <section className={styles.supportingEvidence} aria-label="Supporting Atlas evidence">
          <button
            type="button"
            className={styles.evidenceToggle}
            aria-expanded={supportingEvidenceOpen}
            onClick={() => setSupportingEvidenceOpen((open) => !open)}
          >
            <span>
              <small>Coverage and supporting evidence</small>
              <strong>Daily collection volume, price ladder, and recent listing images</strong>
            </span>
            <b>{supportingEvidenceOpen ? "Close" : "Open"} <span aria-hidden>{supportingEvidenceOpen ? "−" : "+"}</span></b>
          </button>
          {supportingEvidenceOpen ? (
            <div className={styles.evidenceContents}>
              <div className={`${styles.dashboardGrid} ${styles.secondaryGrid}`}>
                <section className={`${styles.panel} ${styles.capturePanel}`} aria-labelledby="compact-capture-title">
                  <header className={styles.panelHeader}>
                    <div>
                      <p className={styles.eyebrow}>02 / Capture trend</p>
                      <h2 id="compact-capture-title">Daily observed listings</h2>
                    </div>
                    <p>Each point counts unique listings with a price observation that day. Spikes describe collection volume, not demand.</p>
                  </header>
                  {snapshot.dailyObservations.length > 0 ? (
                    <>
                      <DailyCaptureChart days={snapshot.dailyObservations} />
                      <div className={styles.captureCells} aria-label="Exact daily observed listing counts">
                        {snapshot.dailyObservations.map((day) => (
                          <div key={day.date} style={{ "--cell-strength": 0.12 + (day.count / maxDaily) * 0.68 } as CSSProperties}>
                            <span>{day.label}</span><strong>{day.count}</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <p className={styles.emptyCapture}>Daily observation coverage was unavailable for this snapshot.</p>}
                </section>
                <section className={`${styles.panel} ${styles.ladderPanel}`} aria-labelledby="compact-ladder-title">
                  <header className={styles.panelHeaderCompact}>
                    <p className={styles.eyebrow}>03 / Current traits</p>
                    <h2 id="compact-ladder-title">Price ladder</h2>
                    <p>Ranked by median asking price. Fresh sample depth remains attached to every row.</p>
                  </header>
                  <div className={styles.ladderRows}>
                    {rankedTraits.map((trait, index) => (
                      <div className={styles.ladderRow} key={trait.name}>
                        <span>{String(index + 1).padStart(2, "0")}</span><strong>{trait.name}</strong>
                        <div><span style={{ width: `${(trait.median / maxMedian) * 100}%` }} /></div>
                        <b>{formatPrice(trait.median)}</b><small>n={trait.count}</small>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <section className={styles.evidenceGallery} aria-labelledby="compact-gallery-title">
                <header>
                  <div><p className={styles.eyebrow}>04 / Listing evidence</p><h2 id="compact-gallery-title">Recent specimens</h2></div>
                  <p>Images resolve from the same recently confirmed listing rows behind the current market layer.</p>
                </header>
                {snapshot.specimens.length > 0 ? (
                  <div>
                    {snapshot.specimens.map((item, index) => (
                      <figure key={`${item.src}-${index}`}>
                        {item.href ? <Link href={item.href} aria-label={`Open ${item.label} listing`}><Image src={item.src} alt={`${item.label} crested gecko from a recent listing`} fill sizes="(max-width: 700px) 50vw, 25vw" /></Link> : <Image src={item.src} alt={`${item.label} crested gecko from a recent listing`} fill sizes="(max-width: 700px) 50vw, 25vw" />}
                        <figcaption><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.label}</strong><small>Recently confirmed listing</small></figcaption>
                      </figure>
                    ))}
                  </div>
                ) : <p className={styles.emptyGallery}>No recently confirmed listing images were available in this snapshot.</p>}
              </section>
            </div>
          ) : null}
        </section>
      ) : <section className={styles.evidenceGallery} aria-labelledby="gallery-title">
        <header>
          <div><p className={styles.eyebrow}>04 / Listing evidence</p><h2 id="gallery-title">Recent specimens</h2></div>
          <p>Images resolve from the same recently confirmed listing rows behind the current market layer.</p>
        </header>
        {snapshot.specimens.length > 0 ? (
          <div>
            {snapshot.specimens.map((item, index) => (
              <figure key={`${item.src}-${index}`}>
                {item.href ? (
                  <Link href={item.href} aria-label={`Open ${item.label} listing`}>
                    <Image src={item.src} alt={`${item.label} crested gecko from a recent listing`} fill sizes="(max-width: 700px) 50vw, 25vw" />
                  </Link>
                ) : (
                  <Image src={item.src} alt={`${item.label} crested gecko from a recent listing`} fill sizes="(max-width: 700px) 50vw, 25vw" />
                )}
                <figcaption><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.label}</strong><small>Recently confirmed listing</small></figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className={styles.emptyGallery}>No recently confirmed listing images were available in this snapshot.</p>
        )}
      </section>}

      {!compact ? <footer className={styles.footer}>
        <div><span>Atlas data boundary</span><p>Current trait figures are asking-price summaries, not completed-sale valuations. Daily totals describe observed coverage, not total market activity.</p></div>
        <div className={styles.footerLinks}><span>Continue exploring</span><p><Link href="/market">Market</Link><Link href="/sold">Sold archive</Link><Link href="/sellers">Sellers</Link><Link href="/status">Data status</Link></p></div>
      </footer> : null}
    </div>
  );
}
