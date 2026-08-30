import Image from "next/image";
import DesignLabShell from "@/components/design-lab/DesignLabShell";
import NocturneVariantNav from "@/components/design-lab/NocturneVariantNav";
import TrendLine from "@/components/design-lab/TrendLine";
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

export default function NocturnePlotPage() {
  const snapshot = DESIGN_LAB_SNAPSHOT;
  const sortedTraits = [...snapshot.traits].sort((a, b) => b.median - a.median);

  return (
    <DesignLabShell active="nocturne" className={styles.plotPage}>
      <NocturneVariantNav active="plot" />
      <main>
        <header className={styles.plotHeader}>
          <div>
            <p className={styles.plotLabel}>Variation B / Analytical notebook</p>
            <h1>Market observations</h1>
          </div>
          <p>
            A compact working view of the same fixed snapshot. Every panel states its measure, time window, and limitation.
          </p>
        </header>

        <section className={styles.plotGrid}>
          <article className={styles.plotPhoto}>
            <Image
              src={DESIGN_LAB_IMAGES.cappuccino}
              alt="Cappuccino crested gecko from a recent public listing"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 50vw"
            />
            <div>
              <span>Recent listing image</span>
              <strong>Cappuccino</strong>
              <span>Observed ask median: $324.37 · n=68</span>
            </div>
          </article>

          <article className={styles.plotReadout}>
            <p className={styles.plotLabel}>Current ask market</p>
            <strong>${snapshot.medianAsk}</strong>
            <span>median asking price</span>
            <dl>
              <div><dt>Window</dt><dd>{snapshot.observedWindow}</dd></div>
              <div><dt>Observations</dt><dd>{snapshot.recentListings}</dd></div>
              <div><dt>Range</dt><dd>{snapshot.askingRange}</dd></div>
            </dl>
          </article>

          <figure className={`${styles.plotPanel} ${styles.plotLinePanel}`}>
            <header>
              <div>
                <p className={styles.plotLabel}>Figure 01</p>
                <h2>Daily capture volume</h2>
                <p>Listing observations by day · Aug 22–29, 2026 · count</p>
              </div>
              <span>8 daily points</span>
            </header>
            <TrendLine
              values={snapshot.dailyListings}
              labels={snapshot.days}
              className={styles.plotLine}
            />
            <ol className={styles.plotPointList} aria-label="Exact daily values">
              {snapshot.dailyListings.map((value, index) => (
                <li key={snapshot.days[index]}><span>Aug {snapshot.days[index]}</span><strong>{value}</strong></li>
              ))}
            </ol>
            <figcaption>Capture volume varies materially. This series is collection coverage, not a demand signal.</figcaption>
          </figure>

          <figure className={`${styles.plotPanel} ${styles.plotTraitPanel}`}>
            <header>
              <div>
                <p className={styles.plotLabel}>Figure 02</p>
                <h2>Trait ask medians</h2>
                <p>Recent public listings · USD · sample size shown</p>
              </div>
              <span>6 trait labels</span>
            </header>
            <table className={styles.plotTable}>
              <thead><tr><th>Trait</th><th>Median ask</th><th>n</th></tr></thead>
              <tbody>
                {sortedTraits.map((trait) => (
                  <tr key={trait.name}>
                    <th>{trait.name}</th>
                    <td>{formatPrice(trait.median)}</td>
                    <td>{trait.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <figcaption>These medians describe seller positioning. They do not estimate clearing price.</figcaption>
          </figure>

          <aside className={styles.plotArchive}>
            <p className={styles.plotLabel}>Historical boundary</p>
            <strong>{snapshot.soldRecords.toLocaleString()}</strong>
            <span>price-known sold records</span>
            <p>The archive window is {snapshot.soldWindow}. It is not presented as current.</p>
          </aside>
        </section>

        <aside className={styles.plotReference}>
          <span>Reference / Observable Plot + D3</span>
          <p>
            Borrowed principle: a layered grammar, repeated small panels, quiet scaffolding, and exact values available beside the picture. Popularity check on Aug 30, 2026: D3 had 113,577 GitHub stars and Observable Plot had 5,362. <a href="https://observablehq.com/plot/" target="_blank" rel="noreferrer">Explore Observable Plot ↗</a>
          </p>
        </aside>
      </main>
    </DesignLabShell>
  );
}
