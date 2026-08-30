import Image from "next/image";
import DesignLabShell from "@/components/design-lab/DesignLabShell";
import TrendLine from "@/components/design-lab/TrendLine";
import {
  DESIGN_LAB_IMAGES,
  DESIGN_LAB_SNAPSHOT,
} from "@/components/design-lab/data";
import styles from "@/components/design-lab/design-lab.module.css";

export default function FieldNotesPage() {
  const snapshot = DESIGN_LAB_SNAPSHOT;

  return (
    <DesignLabShell active="field-notes" className={styles.fieldNotes}>
      <article className={styles.fieldPage}>
        <header className={styles.fieldMasthead}>
          <span>GECK INTELLECT</span>
          <span>MARKET FIELD NOTES</span>
          <span>VOL. 08 / 30 / 26</span>
        </header>

        <section className={styles.fieldHero}>
          <aside className={styles.fieldMargin} aria-label="Specimen classification">
            <span>SPECIMEN 3944236</span>
            <span>CORREL0PHUS CILIATUS</span>
            <span>AXANTHIC × EXTREME HARLEQUIN</span>
            <span>OBSERVED ASK · $200</span>
          </aside>
          <div className={styles.fieldTitle}>
            <p>FIELD REPORT / UNITED STATES MARKET</p>
            <h1>The market,<br />observed in the wild.</h1>
            <p className={styles.fieldDeck}>
              A weekly reading of asking prices, visible supply, and the limits of what the feed can prove.
            </p>
          </div>
          <figure className={styles.fieldSpecimen}>
            <Image
              src={DESIGN_LAB_IMAGES.axanthic}
              alt="Axanthic and extreme harlequin crested gecko observed in the market feed"
              fill
              priority
              sizes="(max-width: 760px) 90vw, 46vw"
            />
            <figcaption>Fig. 01 · FernGully Cresties · observed Aug 26</figcaption>
          </figure>
          <div className={styles.fieldPullQuote}>
            <span>THE SHORT READ</span>
            <p>
              Supply is visible now. Completed-sale evidence ends in early June. Use the first to read
              current competition and the second only as historical context.
            </p>
          </div>
        </section>

        <section className={styles.fieldMetrics} aria-label="Current market measures">
          <div>
            <span>01 / CURRENT SUPPLY</span>
            <strong>{snapshot.recentListings}</strong>
            <p>listed observations dated {snapshot.observedWindow}</p>
          </div>
          <div>
            <span>02 / CENTRAL ASK</span>
            <strong>${snapshot.medianAsk}</strong>
            <p>median after removing the obvious $1m outlier</p>
          </div>
          <div>
            <span>03 / SOLD ARCHIVE</span>
            <strong>{snapshot.soldRecords.toLocaleString()}</strong>
            <p>price-known records, last observed {snapshot.soldWindow}</p>
          </div>
        </section>

        <section className={styles.fieldTrend}>
          <div className={styles.fieldSectionLabel}>
            <span>PLATE A</span>
            <h2>Newly observed asks</h2>
            <p>Daily listing records across the current eight-day window. Counts reflect capture volume, not sales velocity.</p>
          </div>
          <TrendLine
            values={snapshot.dailyListings}
            labels={snapshot.days}
            className={styles.fieldChart}
          />
        </section>

        <section className={styles.fieldTraits}>
          <div className={styles.fieldSectionLabel}>
            <span>PLATE B</span>
            <h2>Trait observations</h2>
          </div>
          <div className={styles.fieldTraitRows}>
            {snapshot.traits.map((trait, index) => (
              <div key={trait.name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{trait.name}</strong>
                <span>n = {trait.count}</span>
                <span>${Math.round(trait.median)}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className={styles.fieldFooter}>
          <p>
            Method note: prototype values are a fixed public-feed snapshot generated {snapshot.generatedAt}.
            Asking prices are not confirmed transactions. The outlier rule excludes asks at or above $100,000.
          </p>
          <span>FIELD NOTES / DIRECTION 01</span>
        </footer>
      </article>
    </DesignLabShell>
  );
}
