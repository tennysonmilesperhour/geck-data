"use client";

import Image from "next/image";
import { useState } from "react";
import type { CSSProperties } from "react";
import {
  DESIGN_LAB_IMAGES,
  DESIGN_LAB_SNAPSHOT,
} from "./data";
import styles from "./atlas-experiments.module.css";

type Trait = (typeof DESIGN_LAB_SNAPSHOT.traits)[number];
type SortMode = "median" | "count";

const TRAIT_IMAGES: Record<Trait["name"], string> = {
  "Lilly White": DESIGN_LAB_IMAGES.lilly,
  Harlequin: DESIGN_LAB_IMAGES.dalmatian,
  Axanthic: DESIGN_LAB_IMAGES.axanthic,
  Cappuccino: DESIGN_LAB_IMAGES.cappuccino,
  "Tri-color": DESIGN_LAB_IMAGES.lilly,
  Dalmatian: DESIGN_LAB_IMAGES.dalmatian,
};

const formatPrice = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);

export function AtlasRankExperiment() {
  const snapshot = DESIGN_LAB_SNAPSHOT;
  const [sortMode, setSortMode] = useState<SortMode>("median");
  const [selectedName, setSelectedName] = useState<Trait["name"]>("Axanthic");
  const selected = snapshot.traits.find((trait) => trait.name === selectedName) ?? snapshot.traits[0];
  const sortedTraits = [...snapshot.traits].sort((a, b) => b[sortMode] - a[sortMode]);
  const maxValue = Math.max(...snapshot.traits.map((trait) => trait[sortMode]));

  return (
    <main className={styles.rankPage}>
      <header className={styles.rankHeader}>
        <div>
          <p>D1 / Sortable rank</p>
          <h1>Trait index</h1>
        </div>
        <p>Hover to compare. Click a row to hold its specimen. Change the ranking measure without leaving the table.</p>
      </header>

      <section className={styles.rankWorkspace}>
        <figure className={styles.rankSpecimen}>
          <Image
            key={selected.name}
            src={TRAIT_IMAGES[selected.name]}
            alt={`${selected.name} crested gecko from a recent listing`}
            fill
            priority
            sizes="(max-width: 820px) 100vw, 42vw"
          />
          <figcaption>
            <span>Selected trait</span>
            <strong>{selected.name}</strong>
            <div><b>{formatPrice(selected.median)}</b><small>median ask</small></div>
            <div><b>{selected.count}</b><small>observations</small></div>
          </figcaption>
        </figure>

        <div className={styles.rankTablePanel}>
          <div className={styles.rankControls} role="group" aria-label="Sort traits by">
            <span>Rank by</span>
            <button type="button" aria-pressed={sortMode === "median"} onClick={() => setSortMode("median")}>
              Median ask
            </button>
            <button type="button" aria-pressed={sortMode === "count"} onClick={() => setSortMode("count")}>
              Sample size
            </button>
          </div>

          <div className={styles.rankRows} aria-label={`Traits ranked by ${sortMode === "median" ? "median asking price" : "sample size"}`}>
            {sortedTraits.map((trait, index) => {
              const value = trait[sortMode];
              const selectedRow = trait.name === selected.name;
              return (
                <button
                  type="button"
                  key={`${sortMode}-${trait.name}`}
                  className={styles.rankRow}
                  data-selected={selectedRow || undefined}
                  onClick={() => setSelectedName(trait.name)}
                >
                  <span className={styles.rankPosition}>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{trait.name}</strong>
                  <span className={styles.rankBar} aria-hidden="true">
                    <span style={{ width: `${(value / maxValue) * 100}%` }} />
                  </span>
                  <span className={styles.rankValue}>
                    {sortMode === "median" ? formatPrice(trait.median) : `n=${trait.count}`}
                  </span>
                  <span className={styles.rankAction}>{selectedRow ? "Held" : "Hold →"}</span>
                </button>
              );
            })}
          </div>
          <p className={styles.rankNote}>
            Recent public listings · {snapshot.observedWindow} · asking prices are not completed sales
          </p>
        </div>
      </section>
    </main>
  );
}

const ORBIT_POSITIONS = [
  { name: "Lilly White", x: 50, y: 5 },
  { name: "Axanthic", x: 83, y: 24 },
  { name: "Cappuccino", x: 88, y: 69 },
  { name: "Tri-color", x: 54, y: 91 },
  { name: "Dalmatian", x: 16, y: 72 },
  { name: "Harlequin", x: 11, y: 27 },
] as const;

export function AtlasOrbitExperiment() {
  const snapshot = DESIGN_LAB_SNAPSHOT;
  const [selectedName, setSelectedName] = useState<Trait["name"]>("Lilly White");
  const selected = snapshot.traits.find((trait) => trait.name === selectedName) ?? snapshot.traits[0];
  const maxMedian = Math.max(...snapshot.traits.map((trait) => trait.median));
  const maxCount = Math.max(...snapshot.traits.map((trait) => trait.count));

  return (
    <main className={styles.orbitPage}>
      <header className={styles.orbitHeader}>
        <div><p>D2 / Radial selector</p><h1>Trait orbit</h1></div>
        <p>Hover to inspect a node. Click to move its evidence into focus. Position is navigation only and does not encode value.</p>
      </header>

      <section className={styles.orbitWorkspace}>
        <div className={styles.orbitField}>
          <div className={styles.orbitRings} aria-hidden="true"><span /><span /><span /></div>
          {ORBIT_POSITIONS.map((position) => {
            const trait = snapshot.traits.find((item) => item.name === position.name) ?? snapshot.traits[0];
            return (
              <button
                key={position.name}
                type="button"
                className={styles.orbitNode}
                style={{ "--orbit-x": `${position.x}%`, "--orbit-y": `${position.y}%` } as CSSProperties}
                aria-pressed={selected.name === trait.name}
                onClick={() => setSelectedName(trait.name)}
              >
                <span>{trait.name}</span>
                <small>{formatPrice(trait.median)} · n={trait.count}</small>
              </button>
            );
          })}

          <figure className={styles.orbitCore}>
            <Image
              key={selected.name}
              src={TRAIT_IMAGES[selected.name]}
              alt={`${selected.name} crested gecko from a recent listing`}
              fill
              priority
              sizes="(max-width: 760px) 54vw, 30vw"
            />
            <figcaption><span>Held in focus</span><strong>{selected.name}</strong></figcaption>
          </figure>
        </div>

        <aside className={styles.orbitReadout} aria-live="polite">
          <p>Selected evidence</p>
          <strong>{selected.name}</strong>
          <dl>
            <div><dt>Median ask</dt><dd>{formatPrice(selected.median)}</dd></div>
            <div><dt>Sample size</dt><dd>n={selected.count}</dd></div>
          </dl>
          <div className={styles.orbitMeasures}>
            <div><span>Price / $450</span><span className={styles.orbitMeasureTrack}><b style={{ width: `${(selected.median / maxMedian) * 100}%` }} /></span></div>
            <div><span>Sample / 120</span><span className={styles.orbitMeasureTrack}><b style={{ width: `${(selected.count / maxCount) * 100}%` }} /></span></div>
          </div>
          <p>Recent public listings · {snapshot.observedWindow}<br />Asking price is not a completed sale.</p>
        </aside>
      </section>
    </main>
  );
}

const DECK_ITEMS = [
  { name: "Dalmatian", image: DESIGN_LAB_IMAGES.dalmatian, rotation: -8 },
  { name: "Lilly White", image: DESIGN_LAB_IMAGES.lilly, rotation: 5 },
  { name: "Axanthic", image: DESIGN_LAB_IMAGES.axanthic, rotation: -3 },
  { name: "Cappuccino", image: DESIGN_LAB_IMAGES.cappuccino, rotation: 8 },
] as const;

export function AtlasDeckExperiment() {
  const snapshot = DESIGN_LAB_SNAPSHOT;
  const [selectedName, setSelectedName] = useState<(typeof DECK_ITEMS)[number]["name"]>("Axanthic");
  const selectedCard = DECK_ITEMS.find((item) => item.name === selectedName) ?? DECK_ITEMS[0];
  const selectedTrait = snapshot.traits.find((trait) => trait.name === selectedName) ?? snapshot.traits[0];

  return (
    <main className={styles.deckPage}>
      <header className={styles.deckHeader}>
        <p>D3 / Specimen deck</p>
        <h1>Pick a card</h1>
        <p>Hover to disturb the stack. Click a specimen to bring its evidence to the front.</p>
      </header>

      <section className={styles.deckWorkspace}>
        <aside className={styles.deckReadout} aria-live="polite">
          <span>Front card / {String(DECK_ITEMS.findIndex((item) => item.name === selectedCard.name) + 1).padStart(2, "0")}</span>
          <strong>{selectedCard.name}</strong>
          <div className={styles.deckNumbers}>
            <div><b>{formatPrice(selectedTrait.median)}</b><small>median ask</small></div>
            <div><b>{selectedTrait.count}</b><small>observations</small></div>
          </div>
          <div className={styles.deckPicker} role="group" aria-label="Choose a specimen card">
            {DECK_ITEMS.map((item, index) => (
              <button
                key={item.name}
                type="button"
                aria-label={`Show ${item.name} card`}
                aria-pressed={item.name === selectedCard.name}
                onClick={() => setSelectedName(item.name)}
              >
                {String(index + 1).padStart(2, "0")}
              </button>
            ))}
          </div>
          <p>Recent public listings<br />{snapshot.observedWindow}</p>
          <p>Click another card to change the evidence view. Asking prices are not completed sales.</p>
        </aside>

        <div className={styles.deckStack} aria-label="Trait specimen cards">
          {DECK_ITEMS.map((item, index) => {
            const trait = snapshot.traits.find((entry) => entry.name === item.name) ?? snapshot.traits[0];
            const active = item.name === selectedCard.name;
            return (
              <button
                key={item.name}
                type="button"
                className={styles.deckCard}
                data-active={active || undefined}
                aria-pressed={active}
                style={{
                  "--deck-left": `${8 + index * 13}%`,
                  "--deck-mobile-left": `${2 + index * 9}%`,
                  "--deck-top": `${12 + index * 5}%`,
                  "--deck-rotation": `${item.rotation}deg`,
                } as CSSProperties}
                onClick={() => setSelectedName(item.name)}
              >
                <Image src={item.image} alt={`${item.name} crested gecko`} fill sizes="(max-width: 760px) 58vw, 29vw" />
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.name}</strong>
                <small>{formatPrice(trait.median)} · n={trait.count}</small>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

export function AtlasScanExperiment() {
  const snapshot = DESIGN_LAB_SNAPSHOT;
  const [activeDay, setActiveDay] = useState(1);
  const [selectedName, setSelectedName] = useState<Trait["name"]>("Cappuccino");
  const selectedTrait = snapshot.traits.find((trait) => trait.name === selectedName) ?? snapshot.traits[0];
  const maxDaily = Math.max(...snapshot.dailyListings);
  const dailyValue = snapshot.dailyListings[activeDay];

  return (
    <main className={styles.scanPage}>
      <header className={styles.scanHeader}>
        <div><p>D4 / Coverage scanner</p><h1>Signal check</h1></div>
        <p>Hover to preview a channel. Click a date or trait to lock the readout. Daily volume describes capture coverage, not demand.</p>
      </header>

      <section className={styles.scanConsole}>
        <aside className={styles.scanDays} aria-label="Daily capture volume">
          <p>Channel / date</p>
          {snapshot.dailyListings.map((value, index) => (
            <button
              key={snapshot.days[index]}
              type="button"
              aria-pressed={activeDay === index}
              onClick={() => setActiveDay(index)}
            >
              <span>08.{snapshot.days[index]}</span>
              <span className={styles.scanBar}><b style={{ width: `${(value / maxDaily) * 100}%` }} /></span>
              <strong>{value}</strong>
            </button>
          ))}
        </aside>

        <figure className={styles.scanScreen}>
          <Image
            key={selectedTrait.name}
            src={TRAIT_IMAGES[selectedTrait.name]}
            alt={`${selectedTrait.name} crested gecko from a recent listing`}
            fill
            priority
            sizes="(max-width: 860px) 100vw, 48vw"
          />
          <div className={styles.scanLines} aria-hidden="true" />
          <figcaption>
            <span>Capture / Aug {snapshot.days[activeDay]}</span>
            <strong>{dailyValue}</strong>
            <small>observed listings</small>
            <p>{selectedTrait.name} · {formatPrice(selectedTrait.median)} median ask · n={selectedTrait.count}</p>
          </figcaption>
        </figure>

        <aside className={styles.scanTraits} aria-label="Trait channels">
          <p>Channel / trait</p>
          {snapshot.traits.map((trait, index) => (
            <button
              key={trait.name}
              type="button"
              aria-pressed={trait.name === selectedTrait.name}
              onClick={() => setSelectedName(trait.name)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{trait.name}</strong>
              <small>{formatPrice(trait.median)}</small>
            </button>
          ))}
          <p className={styles.scanBoundary}>Sold archive ends Jun 7, 2026<br />Current asks and historical sales remain separate.</p>
        </aside>
      </section>
    </main>
  );
}
