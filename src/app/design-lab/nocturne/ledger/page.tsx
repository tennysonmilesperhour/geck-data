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

export default function NocturneLedgerPage() {
  const snapshot = DESIGN_LAB_SNAPSHOT;
  const sortedTraits = [...snapshot.traits].sort((a, b) => b.median - a.median);
  const maxMedian = Math.max(...sortedTraits.map((trait) => trait.median));
  const maxDaily = Math.max(...snapshot.dailyListings);

  return (
    <DesignLabShell active="nocturne" className={styles.ledgerPage}>
      <NocturneVariantNav active="ledger" />
      <main>
        <section className={styles.ledgerHero}>
          <div className={styles.ledgerIntro}>
            <div>
              <p className={styles.ledgerKicker}>Variation A / Newsroom ledger</p>
              <h1>Current market snapshot</h1>
              <p className={styles.ledgerDeck}>
                Asking prices from the public feed, with historical sales kept in a separate time frame.
              </p>
            </div>
            <p className={styles.ledgerScope}>
              <span>United States</span>
              <span>{snapshot.observedWindow}</span>
              <span>{snapshot.recentListings} observations</span>
            </p>
          </div>
          <div className={styles.ledgerImage}>
            <Image
              src={DESIGN_LAB_IMAGES.axanthic}
              alt="Axanthic crested gecko from a recent public listing"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 42vw"
            />
          </div>
        </section>

        <section className={styles.ledgerMetrics} aria-label="Market summary">
          <article><span>Recent listings</span><strong>{snapshot.recentListings}</strong></article>
          <article><span>Median asking price</span><strong>${snapshot.medianAsk}</strong></article>
          <article><span>Observed ask range</span><strong>{snapshot.askingRange}</strong></article>
          <article><span>Price-known sold records</span><strong>{snapshot.soldRecords.toLocaleString()}</strong></article>
        </section>

        <section className={styles.ledgerAnalysis}>
          <div className={styles.ledgerAside}>
            <p className={styles.sectionLabel}>Observed asking prices by trait</p>
            <h2>Median ask</h2>
            <p>
              Ranked current medians for six trait labels. Sample size is shown beside each value. These are listing prices, not completed sales.
            </p>
          </div>
          <figure className={styles.ledgerFigure}>
            <div className={styles.ledgerScale} aria-hidden="true">
              <span />
              <div><span>$0</span><span>$225</span><span>$450</span></div>
              <span />
            </div>
            <div className={styles.traitBars}>
              {sortedTraits.map((trait) => (
                <div className={styles.traitBarRow} key={trait.name}>
                  <span className={styles.traitBarLabel}>{trait.name}</span>
                  <span className={styles.traitBarTrack}>
                    <span
                      className={styles.traitBarFill}
                      style={{ width: `${(trait.median / maxMedian) * 100}%` }}
                    />
                  </span>
                  <span className={styles.traitBarValue}>
                    {formatPrice(trait.median)}
                    <small>n={trait.count}</small>
                  </span>
                </div>
              ))}
            </div>
            <figcaption>Source: fixed public-feed snapshot generated {snapshot.generatedAt}.</figcaption>
          </figure>
        </section>

        <section className={styles.ledgerDaily}>
          <div className={styles.ledgerDailyHeader}>
            <div>
              <p className={styles.sectionLabel}>Capture volume / Aug 22–29</p>
              <h2>Daily observation counts</h2>
            </div>
            <p>
              The uneven pattern reflects collection volume. It should not be interpreted as a demand trend.
            </p>
          </div>
          <div className={styles.dailyBars} role="img" aria-label={`Daily observation counts: ${snapshot.dailyListings.join(", ")}`}>
            {snapshot.dailyListings.map((value, index) => (
              <div key={snapshot.days[index]} style={{ height: `${(value / maxDaily) * 100}%` }}>
                <strong>{value}</strong>
                <span>{snapshot.days[index]}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className={styles.ledgerReference}>
          <p>Reference / Datawrapper + Reuters Graphics</p>
          <p>
            Borrowed principle: restrained typography, direct labels, visible units, and chart notes placed with the evidence. Reuters identifies Datawrapper as its official newsroom charting tool. <a href="https://reuters-graphics.github.io/newsroom-datawrapper-guide/" target="_blank" rel="noreferrer">View the Reuters newsroom guide ↗</a>
          </p>
        </aside>

        <footer className={styles.ledgerFooter}>
          <span>Fixed public-feed snapshot · generated {snapshot.generatedAt}</span>
          <span>Variation A / Ledger</span>
        </footer>
      </main>
    </DesignLabShell>
  );
}
