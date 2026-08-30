import Image from "next/image";
import DesignLabShell from "@/components/design-lab/DesignLabShell";
import {
  DESIGN_LAB_IMAGES,
  DESIGN_LAB_SNAPSHOT,
} from "@/components/design-lab/data";
import styles from "@/components/design-lab/design-lab.module.css";

const POSTERS = [
  {
    number: "01",
    trait: "LILLY WHITE",
    value: "$400",
    count: "N120",
    image: DESIGN_LAB_IMAGES.lilly,
    className: "posterYellow",
  },
  {
    number: "02",
    trait: "AXANTHIC",
    value: "$450",
    count: "N58",
    image: DESIGN_LAB_IMAGES.axanthic,
    className: "posterPink",
  },
  {
    number: "03",
    trait: "CAPPUCCINO",
    value: "$324",
    count: "N68",
    image: DESIGN_LAB_IMAGES.cappuccino,
    className: "posterOrange",
  },
  {
    number: "04",
    trait: "DALMATIAN",
    value: "$150",
    count: "N56",
    image: DESIGN_LAB_IMAGES.dalmatian,
    className: "posterBlue",
  },
] as const;

export default function PosterWallPage() {
  const snapshot = DESIGN_LAB_SNAPSHOT;

  return (
    <DesignLabShell active="poster-wall" className={styles.posterWall}>
      <article className={styles.posterPage}>
        <header className={styles.posterHeader}>
          <span>GECK INTELLECT PRESENTS</span>
          <span>THE ASK MARKET / ISSUE 243</span>
          <span>08.30.26</span>
        </header>

        <section className={styles.posterHero}>
          <p>MARKET DATA CAN HAVE A PULSE WITHOUT PRETENDING TO BE LIVE.</p>
          <h1>THE MARKET<br /><span>IN MOTION</span></h1>
          <div className={styles.posterHeroStamp}>
            <strong>{snapshot.recentListings}</strong>
            <span>RECENT LISTINGS</span>
          </div>
          <div className={styles.posterHeroFoot}>
            <span>ASKING PRICES / UNITED STATES</span>
            <span>SCROLL FOR THE POSTERS ↓</span>
          </div>
        </section>

        <div className={styles.posterTicker} aria-label="Trait median asking prices">
          <div>
            {snapshot.traits.concat(snapshot.traits).map((trait, index) => (
              <span key={`${trait.name}-${index}`}>{trait.name} ${Math.round(trait.median)} / </span>
            ))}
          </div>
        </div>

        <section className={styles.posterGrid} aria-label="Trait market posters">
          {POSTERS.map((poster) => (
            <figure key={poster.trait} className={styles[poster.className]}>
              <div className={styles.posterMeta}>
                <span>{poster.number}</span>
                <span>ASK MEDIAN</span>
                <span>{poster.count}</span>
              </div>
              <h2>{poster.trait}</h2>
              <div className={styles.posterPhoto}>
                <Image src={poster.image} alt={`${poster.trait.toLowerCase()} crested gecko`} fill sizes="(max-width: 800px) 100vw, 50vw" />
              </div>
              <strong className={styles.posterPrice}>{poster.value}</strong>
              <figcaption>VISIBLE SUPPLY / {snapshot.observedWindow.toUpperCase()} / ASKS ≠ SALES</figcaption>
            </figure>
          ))}
        </section>

        <section className={styles.posterTruth}>
          <p>THE DATA LABEL</p>
          <h2>LOUD ABOUT THE LOOK.<br />PRECISE ABOUT THE CLAIM.</h2>
          <div>
            <p>
              The fresh ask median is ${snapshot.medianAsk} across {snapshot.recentListings} recent observations.
              One obvious million-dollar outlier is excluded.
            </p>
            <p>
              Sold evidence is historical: {snapshot.soldRecords.toLocaleString()} price-known records from {snapshot.soldWindow}.
              No current-sale inference is made from that archive.
            </p>
          </div>
        </section>

        <footer className={styles.posterFooter}>
          <span>STATIC PROTOTYPE / PUBLIC FEED {snapshot.generatedAt}</span>
          <strong>GECK!</strong>
          <span>DIRECTION 04 / POSTER WALL</span>
        </footer>
      </article>
    </DesignLabShell>
  );
}
