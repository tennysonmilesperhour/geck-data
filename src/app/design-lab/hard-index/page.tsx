import Image from "next/image";
import DesignLabShell from "@/components/design-lab/DesignLabShell";
import TrendLine from "@/components/design-lab/TrendLine";
import {
  DESIGN_LAB_IMAGES,
  DESIGN_LAB_SNAPSHOT,
} from "@/components/design-lab/data";
import styles from "@/components/design-lab/design-lab.module.css";

export default function HardIndexPage() {
  const snapshot = DESIGN_LAB_SNAPSHOT;
  const maxMedian = Math.max(...snapshot.traits.map((trait) => trait.median));

  return (
    <DesignLabShell active="hard-index" className={styles.hardIndex}>
      <article className={styles.hardBoard}>
        <header className={styles.hardHeader}>
          <span>GI / US / ASK MARKET</span>
          <span>OBSERVATION BOARD 243</span>
          <span>{snapshot.generatedAt}</span>
        </header>

        <section className={styles.hardHero}>
          <div className={styles.hardIntro}>
            <p>ONE WEEK OF VISIBLE SUPPLY</p>
            <h1><span>564</span> MARKET<br />OBSERVATIONS</h1>
          </div>
          <div className={styles.hardImage}>
            <Image
              src={DESIGN_LAB_IMAGES.cappuccino}
              alt="Cappuccino crested gecko listing shown as a market specimen"
              fill
              priority
              sizes="(max-width: 850px) 100vw, 33vw"
            />
            <span>LISTING / MM 4027224</span>
          </div>
          <div className={styles.hardSideCopy}>
            <span>READ THIS FIRST</span>
            <p>
              This is an asking-price index. It shows seller expectations and visible supply.
              It does not claim that an animal sold at the displayed price.
            </p>
          </div>
        </section>

        <section className={styles.hardBands} aria-label="Headline metrics">
          <div>
            <span>MEDIAN FRESH ASK</span>
            <strong>${snapshot.medianAsk}</strong>
          </div>
          <div>
            <span>OBSERVED ASK RANGE</span>
            <strong>{snapshot.askingRange}</strong>
          </div>
          <div>
            <span>SOLD RECORD WINDOW</span>
            <strong>{snapshot.soldWindow}</strong>
          </div>
        </section>

        <section className={styles.hardTrend}>
          <div className={styles.hardSectionHead}>
            <span>FIG 01 / CAPTURE VOLUME</span>
            <h2>Eight days,<br />not a smooth trend.</h2>
            <p>The June bulk backfill is excluded from this close view. Each point is a captured listing date.</p>
          </div>
          <div className={styles.hardChartWrap}>
            <TrendLine
              values={snapshot.dailyListings}
              labels={snapshot.days}
              className={styles.hardChart}
            />
            <span className={styles.hardAxisNote}>AUGUST 2026 →</span>
          </div>
        </section>

        <section className={styles.hardRanking}>
          <div className={styles.hardSectionHead}>
            <span>FIG 02 / TRAIT ASK MEDIANS</span>
            <h2>Price position.</h2>
          </div>
          <div className={styles.hardRows}>
            {snapshot.traits.map((trait, index) => (
              <div key={trait.name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{trait.name}</strong>
                <span className={styles.hardBarTrack} aria-hidden="true">
                  <span style={{ width: `${(trait.median / maxMedian) * 100}%` }} />
                </span>
                <span>n{trait.count}</span>
                <b>${Math.round(trait.median)}</b>
              </div>
            ))}
          </div>
        </section>

        <footer className={styles.hardFooter}>
          <span>PUBLIC FEED SNAPSHOT / STATIC PROTOTYPE</span>
          <p>OUTLIER RULE: $100,000+ EXCLUDED · ASKS ≠ SALES · SOLD ARCHIVE ENDS JUN 07</p>
          <span>DIRECTION 02 / HARD INDEX</span>
        </footer>
      </article>
    </DesignLabShell>
  );
}
