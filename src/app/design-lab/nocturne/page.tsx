import Image from "next/image";
import DesignLabShell from "@/components/design-lab/DesignLabShell";
import TrendLine from "@/components/design-lab/TrendLine";
import {
  DESIGN_LAB_IMAGES,
  DESIGN_LAB_SNAPSHOT,
} from "@/components/design-lab/data";
import styles from "@/components/design-lab/design-lab.module.css";

const GALLERY = [
  {
    image: DESIGN_LAB_IMAGES.dalmatian,
    name: "Dalmatian",
    seller: "C&J Geckos",
    note: "$150 fresh median · n56",
  },
  {
    image: DESIGN_LAB_IMAGES.lilly,
    name: "Lilly White",
    seller: "Sunshine Geckos",
    note: "$400 fresh median · n120",
  },
  {
    image: DESIGN_LAB_IMAGES.axanthic,
    name: "Axanthic",
    seller: "FernGully Cresties",
    note: "$450 fresh median · n58",
  },
] as const;

export default function NocturnePage() {
  const snapshot = DESIGN_LAB_SNAPSHOT;

  return (
    <DesignLabShell active="nocturne" className={styles.nocturne}>
      <article className={styles.nocturnePage}>
        <section className={styles.nocturneHero}>
          <Image
            src={DESIGN_LAB_IMAGES.dalmatian}
            alt="Dalmatian crested gecko in a photographic market study"
            fill
            priority
            sizes="100vw"
          />
          <div className={styles.nocturneShade} />
          <header className={styles.nocturneMasthead}>
            <span>GECK INTELLECT / EXHIBITION 08</span>
            <span>UNITED STATES · ASK MARKET</span>
            <span>AUG 30 2026</span>
          </header>
          <div className={styles.nocturneTitle}>
            <p>A STUDY OF VISIBLE VALUE</p>
            <h1>NOCTURNE<br />FOR A MARKET</h1>
          </div>
          <div className={styles.nocturneCaption}>
            <span>PLATE 01 / DALMATIAN</span>
            <p>Observed in the current listing window. Seller ask is evidence of supply, not a completed transaction.</p>
          </div>
          <div className={styles.nocturneCounter}>01 / 03</div>
        </section>

        <section className={styles.nocturneStatement}>
          <p className={styles.nocturneEyebrow}>CURATORIAL NOTE</p>
          <h2>
            Make the animal the subject.<br />Make uncertainty part of the label.
          </h2>
          <div className={styles.nocturneStatementGrid}>
            <p>
              The market has {snapshot.recentListings} recent asking-price observations. Their median is
              ${snapshot.medianAsk}. That describes current seller positioning; it does not establish clearing price.
            </p>
            <p>
              The completed-sale archive contains {snapshot.soldRecords.toLocaleString()} price-known records,
              but its newest observation is June 7. In this direction, the time boundary is treated like provenance.
            </p>
          </div>
        </section>

        <section className={styles.nocturneGallery} aria-label="Selected trait studies">
          {GALLERY.map((item, index) => (
            <figure key={item.name}>
              <div className={styles.nocturneGalleryImage}>
                <Image src={item.image} alt={`${item.name} crested gecko`} fill sizes="(max-width: 800px) 100vw, 33vw" />
              </div>
              <figcaption>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.name}</strong>
                <span>{item.note}</span>
                <span>{item.seller}</span>
              </figcaption>
            </figure>
          ))}
        </section>

        <section className={styles.nocturneEvidence}>
          <div>
            <p className={styles.nocturneEyebrow}>OBSERVATION RHYTHM / AUG 22–29</p>
            <h2>The gaps are evidence too.</h2>
            <p>
              Capture volume varies by day, so the line is shown as collection rhythm instead of being narrated as demand.
            </p>
          </div>
          <TrendLine
            values={snapshot.dailyListings}
            labels={snapshot.days}
            className={styles.nocturneChart}
          />
        </section>

        <footer className={styles.nocturneFooter}>
          <span>GECK INTELLECT</span>
          <p>Fixed public-feed snapshot · generated {snapshot.generatedAt} · asks are not sales</p>
          <span>DIRECTION 03 / NOCTURNE</span>
        </footer>
      </article>
    </DesignLabShell>
  );
}
