import Image from "next/image";
import DesignLabShell from "@/components/design-lab/DesignLabShell";
import NocturneVariantNav from "@/components/design-lab/NocturneVariantNav";
import {
  DESIGN_LAB_IMAGES,
  DESIGN_LAB_SNAPSHOT,
} from "@/components/design-lab/data";
import styles from "@/components/design-lab/nocturne-variants.module.css";

export default function NocturneStoryPage() {
  const snapshot = DESIGN_LAB_SNAPSHOT;

  return (
    <DesignLabShell active="nocturne" className={styles.storyPage}>
      <NocturneVariantNav active="story" />
      <main>
        <section className={styles.storyIntro}>
          <Image
            src={DESIGN_LAB_IMAGES.dalmatian}
            alt="Dalmatian crested gecko from a public listing"
            fill
            priority
            sizes="100vw"
          />
          <div className={styles.storyShade} />
          <div className={styles.storyIntroCopy}>
            <p>Variation C / Scroll-led explanation</p>
            <h1>What the snapshot says</h1>
            <span>Three findings · one important time boundary</span>
          </div>
          <p className={styles.storyImageNote}>Recent listing image · asking price is not a completed sale</p>
        </section>

        <section className={styles.storyScroller}>
          <div className={styles.storyStickyImage}>
            <Image
              src={DESIGN_LAB_IMAGES.lilly}
              alt="Lilly White crested gecko from a recent public listing"
              fill
              sizes="(max-width: 840px) 100vw, 52vw"
            />
            <p>Lilly White · current median ask $400 · n=120</p>
          </div>
          <div className={styles.storySteps}>
            <article>
              <span>01 / Coverage</span>
              <strong>{snapshot.recentListings}</strong>
              <h2>listings were observed</h2>
              <p>The current feed window runs from {snapshot.observedWindow}. It describes visible supply during those dates.</p>
            </article>
            <article>
              <span>02 / Center</span>
              <strong>${snapshot.medianAsk}</strong>
              <h2>was the median ask</h2>
              <p>Half of observed asking prices were above this point and half were below. It is not a sale-price estimate.</p>
            </article>
            <article>
              <span>03 / Spread</span>
              <strong>{snapshot.askingRange}</strong>
              <h2>was the observed range</h2>
              <p>The range is wide enough that a single overall median should not replace trait-level comparison.</p>
            </article>
            <article className={styles.storyBoundary}>
              <span>04 / Historical boundary</span>
              <strong>Jun 7</strong>
              <h2>is the latest sold date</h2>
              <p>The sold archive contains {snapshot.soldRecords.toLocaleString()} price-known records from {snapshot.soldWindow}. Its older endpoint must stay visible.</p>
            </article>
          </div>
        </section>

        <section className={styles.storyLimits}>
          <header>
            <p>Reading guide</p>
            <h2>Useful now, with limits</h2>
          </header>
          <div>
            <article>
              <span>Supported</span>
              <p>Current asking-price position, visible trait comparisons, sample size, capture coverage, and historical sale context.</p>
            </article>
            <article>
              <span>Not supported</span>
              <p>Current clearing price, demand velocity, sell-through rate, or a claim that daily capture volume represents buyer activity.</p>
            </article>
          </div>
        </section>

        <aside className={styles.storyReference}>
          <span>Reference / The Pudding</span>
          <p>
            Borrowed principle: one finding per viewport, a stable visual anchor, and plain copy that turns methodological limits into part of the story. The Pudding won the 2025 Online Journalism Award for visual digital storytelling. <a href="https://awards.journalists.org/organizations/the-pudding/" target="_blank" rel="noreferrer">Review its awards ↗</a>
          </p>
        </aside>
      </main>
    </DesignLabShell>
  );
}
