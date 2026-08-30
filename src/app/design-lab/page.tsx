import Link from "next/link";
import DesignLabShell from "@/components/design-lab/DesignLabShell";
import {
  DESIGN_DIRECTIONS,
  DESIGN_LAB_SNAPSHOT,
} from "@/components/design-lab/data";
import styles from "@/components/design-lab/design-lab.module.css";

const RESEARCH_SIGNALS = [
  {
    source: "Framer Awards 2025",
    finding:
      "The winning work is governed by a single behavior: sustained editorial unfolding, quiet product space, or unusually considered interaction detail.",
    href: "https://www.framer.com/awards/",
  },
  {
    source: "i-D · Elle Fanning editorial",
    finding:
      "The page uses near-poster-scale type, full-bleed photography, credits as texture, and a long narrative sequence with no rounded interface furniture.",
    href: "https://spotlight.i-d.co/ellefanning",
  },
  {
    source: "Temper Studio · Framer visual-design winner",
    finding:
      "A pale near-neutral ground, one clear product subject at a time, and restrained transitions allow the work to carry the visual weight.",
    href: "https://temper.studio/",
  },
  {
    source: "CSS Design Awards 2026",
    finding:
      "Recent winners are being rewarded for immersive framing and interaction systems, not for repeating a component-library landing page.",
    href: "https://www.cssdesignawards.com/website-gallery/",
  },
  {
    source: "HAOQI.DESIGN · CSSDA WOTD",
    finding:
      "The portfolio turns interface metadata, cursor position, local time, grid lines, and monospace labels into a coherent instrument-panel identity.",
    href: "https://www.cssdesignawards.com/sites/haoqi-design/49819/",
  },
  {
    source: "Revelatio Studio · CSSDA WOTD",
    finding:
      "A nearly black field, photographic and ASCII-like imagery, and sparse navigation create cinematic focus without neon fog or generic glass panels.",
    href: "https://www.cssdesignawards.com/sites/revelatio-studio/49911/",
  },
  {
    source: "Family Style · Awwwards Honorable Mention",
    finding:
      "Huge identity type, decisive cobalt, project-specific imagery, and compact utility navigation make the studio memorable before any case study is opened.",
    href: "https://www.awwwards.com/sites/family-style",
  },
  {
    source: "Good Design Awards · Mat Voyce",
    finding:
      "Distinct layouts for distinct bodies of work, original navigation, and a performance-conscious build created a measurable engagement lift.",
    href: "https://good-design.org/projects/mat-voyce/",
  },
  {
    source: "Creative Bloq · 2026 craft research",
    finding:
      "Texture, evidence of process, analogue surfaces, and controlled imperfection are becoming a counter-signal to frictionless generated sameness.",
    href: "https://www.creativebloq.com/design/graphic-design/texture-warmth-and-tactile-rebellion-the-big-graphic-design-trends-for-2026",
  },
];

const DIRECTION_LOGIC = [
  {
    number: "01",
    name: "Field Notes",
    references: "i-D editorial storytelling + 2026 tactile craft research",
    choice: "Use typographic scale, specimen photography, ruled captions, and visible method notes to make the market feel observed by a person.",
  },
  {
    number: "02",
    name: "Hard Index",
    references: "HAOQI instrument-panel framing + Swiss information posters",
    choice: "Treat counts, ranges, and provenance as the visual material. Every line divides information; nothing floats in a soft card.",
  },
  {
    number: "03",
    name: "Nocturne",
    references: "Temper restraint + Revelatio cinematic immersion",
    choice: "Let one animal command the viewport, then reveal evidence slowly like an exhibition catalogue with provenance labels.",
  },
  {
    number: "04",
    name: "Poster Wall",
    references: "Mat Voyce custom navigation + Family Style and Panton color systems",
    choice: "Use saturated print color, scale, and motion as a studio identity while keeping the claim language brutally precise.",
  },
] as const;

export default function DesignLabPage() {
  return (
    <DesignLabShell className={styles.labIndex}>
      <header className={styles.indexHero}>
        <p className={styles.indexKicker}>Visual research / applied to real market evidence</p>
        <h1>Four ways to see a market.</h1>
        <p className={styles.indexIntro}>
          One data snapshot. Four complete art directions. Each concept removes the default
          AI vocabulary and commits to a different point of view.
        </p>
        <div className={styles.indexSnapshot} aria-label="Shared data snapshot">
          <span>{DESIGN_LAB_SNAPSHOT.recentListings} recent listings</span>
          <span>${DESIGN_LAB_SNAPSHOT.medianAsk} median fresh ask</span>
          <span>As of {DESIGN_LAB_SNAPSHOT.generatedAt}</span>
        </div>
      </header>

      <main className={styles.directionGrid}>
        {DESIGN_DIRECTIONS.map((direction) => (
          <Link
            key={direction.slug}
            href={`/design-lab/${direction.slug}`}
            className={`${styles.directionTile} ${styles[`tile${direction.number}`]}`}
          >
            <span className={styles.directionNumber}>{direction.number}</span>
            <span className={styles.directionName}>{direction.name}</span>
            <span className={styles.directionThesis}>{direction.thesis}</span>
            <span className={styles.directionArrow}>Enter direction ↗</span>
          </Link>
        ))}
      </main>

      <section className={styles.researchSection} aria-labelledby="research-heading">
        <div>
          <p className={styles.indexKicker}>What the research changed</p>
          <h2 id="research-heading">A point of view before a component.</h2>
        </div>
        <div className={styles.researchCopy}>
          <p>
            The repeated AI tells are structural: centered hero copy, interchangeable rounded cards,
            purple or emerald glow, three-item feature rows, and animation added without narrative purpose.
            The response is not random decoration. It is a smaller set of stronger decisions repeated with discipline.
          </p>
          <div className={styles.researchList}>
            {RESEARCH_SIGNALS.map((signal) => (
              <a key={signal.source} href={signal.href} target="_blank" rel="noreferrer">
                <span>{signal.source}</span>
                <p>{signal.finding}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.logicSection} aria-labelledby="logic-heading">
        <div className={styles.logicIntro}>
          <p className={styles.indexKicker}>Translation, not imitation</p>
          <h2 id="logic-heading">The research became rules.</h2>
          <p>
            None of the prototypes copies a reference layout. Each extracts a behavior, joins it to Geck Intellect’s subject matter,
            then holds that behavior consistent across type, imagery, navigation, data display, and disclosure language.
          </p>
        </div>
        <div className={styles.logicRows}>
          {DIRECTION_LOGIC.map((direction) => (
            <div key={direction.number}>
              <span>{direction.number}</span>
              <strong>{direction.name}</strong>
              <span>{direction.references}</span>
              <p>{direction.choice}</p>
            </div>
          ))}
        </div>
      </section>
    </DesignLabShell>
  );
}
