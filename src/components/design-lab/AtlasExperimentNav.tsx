import Link from "next/link";
import styles from "./atlas-experiments.module.css";

const EXPERIMENTS = [
  { href: "/design-lab/nocturne/atlas", number: "D0", label: "Atlas" },
  { href: "/design-lab/nocturne/atlas/rank", number: "D1", label: "Rank" },
  { href: "/design-lab/nocturne/atlas/orbit", number: "D2", label: "Orbit" },
  { href: "/design-lab/nocturne/atlas/deck", number: "D3", label: "Deck" },
  { href: "/design-lab/nocturne/atlas/scan", number: "D4", label: "Scan" },
] as const;

type AtlasExperimentNavProps = {
  active: "atlas" | "rank" | "orbit" | "deck" | "scan";
};

export default function AtlasExperimentNav({ active }: AtlasExperimentNavProps) {
  return (
    <nav className={styles.experimentNav} aria-label="Atlas interaction studies">
      <p>Atlas / Interaction lab</p>
      <div>
        {EXPERIMENTS.map((experiment) => (
          <Link
            key={experiment.href}
            href={experiment.href}
            aria-current={active === experiment.label.toLowerCase() ? "page" : undefined}
          >
            <span>{experiment.number}</span>
            {experiment.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
