import Image from "next/image";
import DesignLabShell from "@/components/design-lab/DesignLabShell";
import NocturneVariantNav from "@/components/design-lab/NocturneVariantNav";
import {
  DESIGN_LAB_IMAGES,
  DESIGN_LAB_SNAPSHOT,
} from "@/components/design-lab/data";
import styles from "@/components/design-lab/nocturne-variants.module.css";

const formatPrice = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);

const IMAGE_STRIP = [
  { src: DESIGN_LAB_IMAGES.dalmatian, label: "Dalmatian" },
  { src: DESIGN_LAB_IMAGES.lilly, label: "Lilly White" },
  { src: DESIGN_LAB_IMAGES.axanthic, label: "Axanthic" },
  { src: DESIGN_LAB_IMAGES.cappuccino, label: "Cappuccino" },
] as const;

export default function NocturneAtlasPage() {
  const snapshot = DESIGN_LAB_SNAPSHOT;
  const sortedTraits = [...snapshot.traits].sort((a, b) => b.median - a.median);
  const maxMedian = Math.max(...snapshot.traits.map((trait) => trait.median));
  const maxCount = Math.max(...snapshot.traits.map((trait) => trait.count));
  const maxDaily = Math.max(...snapshot.dailyListings);

  return (
    <DesignLabShell active="nocturne" className={styles.atlasPage}>
      <NocturneVariantNav active="atlas" />
      <main>
        <header className={styles.atlasHeader}>
          <div>
            <p className={styles.atlasLabel}>Variation D / Evidence atlas</p>
            <h1>Market evidence index</h1>
          </div>
          <p>One dense view for comparing price level, sample support, capture coverage, and historical reach.</p>
        </header>

        <section className={styles.atlasImages} aria-label="Recent listing examples">
          {IMAGE_STRIP.map((image) => (
            <figure key={image.label}>
              <Image src={image.src} alt={`${image.label} crested gecko`} fill sizes="(max-width: 700px) 50vw, 25vw" />
              <figcaption>{image.label}</figcaption>
            </figure>
          ))}
        </section>

        <section className={styles.atlasSummary} aria-label="Snapshot scope">
          <article><span>Current window</span><strong>{snapshot.observedWindow}</strong></article>
          <article><span>Recent listings</span><strong>{snapshot.recentListings}</strong></article>
          <article><span>Median ask</span><strong>${snapshot.medianAsk}</strong></article>
          <article><span>Sold archive</span><strong>{snapshot.soldRecords.toLocaleString()}</strong><small>{snapshot.soldWindow}</small></article>
        </section>

        <section className={styles.atlasTraits}>
          <header>
            <div>
              <p className={styles.atlasLabel}>Trait comparison / recent asks</p>
              <h2>Price level and sample support</h2>
            </div>
            <p>Aligned measures avoid implying correlation from only six trait groups. Values and sample sizes remain directly labeled.</p>
          </header>
          <div className={styles.atlasTable} role="table" aria-label="Median asking price and sample size by trait">
            <div className={styles.atlasTableHead} role="row">
              <span role="columnheader">Trait</span><span role="columnheader">Median ask / $0–$450</span><span role="columnheader">Sample / 0–120</span>
            </div>
            {sortedTraits.map((trait) => (
              <div className={styles.atlasTraitRow} role="row" key={trait.name}>
                <strong role="cell">{trait.name}</strong>
                <div className={styles.atlasMeasure} role="cell">
                  <span style={{ width: `${(trait.median / maxMedian) * 100}%` }} />
                  <b>{formatPrice(trait.median)}</b>
                </div>
                <div className={`${styles.atlasMeasure} ${styles.atlasSample}`} role="cell">
                  <span style={{ width: `${(trait.count / maxCount) * 100}%` }} />
                  <b>n={trait.count}</b>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.atlasCoverage}>
          <header>
            <div>
              <p className={styles.atlasLabel}>Coverage matrix / Aug 22–29</p>
              <h2>Observed listings by day</h2>
            </div>
            <p>Cell strength encodes relative capture volume. Exact counts prevent color from carrying the meaning alone.</p>
          </header>
          <div className={styles.atlasCells}>
            {snapshot.dailyListings.map((value, index) => {
              const strength = 0.18 + (value / maxDaily) * 0.82;
              return (
                <div key={snapshot.days[index]} style={{ backgroundColor: `rgba(185, 121, 71, ${strength})` }}>
                  <span>Aug {snapshot.days[index]}</span>
                  <strong>{value}</strong>
                </div>
              );
            })}
          </div>
        </section>

        <aside className={styles.atlasReference}>
          <span>Reference / Our World in Data + RAWGraphs</span>
          <p>
            Borrowed principle: dense but consistent evidence blocks, explicit source windows, small-multiple comparison, and exact-value access. Our World in Data reports tens of millions of annual readers; RAWGraphs had 9,026 GitHub stars when checked Aug 30, 2026. <a href="https://ourworldindata.org/top-of-the-charts-2025" target="_blank" rel="noreferrer">Our World in Data ↗</a> · <a href="https://github.com/rawgraphs/rawgraphs-app" target="_blank" rel="noreferrer">RAWGraphs ↗</a>
          </p>
        </aside>
      </main>
    </DesignLabShell>
  );
}
