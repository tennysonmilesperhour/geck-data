import Link from "next/link";
import { DESIGN_DIRECTIONS } from "./data";
import styles from "./design-lab.module.css";

type DesignLabShellProps = {
  active?: (typeof DESIGN_DIRECTIONS)[number]["slug"];
  className?: string;
  children: React.ReactNode;
};

export default function DesignLabShell({
  active,
  className = "",
  children,
}: DesignLabShellProps) {
  return (
    <div className={`${styles.shell} ${className}`}>
      <a className={styles.skipLink} href="#concept-content">
        Skip to concept
      </a>
      <nav className={styles.switcher} aria-label="Design direction switcher">
        <Link className={styles.switcherHome} href="/design-lab">
          GECK / DESIGN LAB
        </Link>
        <div className={styles.switcherLinks}>
          {DESIGN_DIRECTIONS.map((direction) => (
            <Link
              key={direction.slug}
              href={`/design-lab/${direction.slug}`}
              aria-current={active === direction.slug ? "page" : undefined}
            >
              <span>{direction.number}</span>
              <span className={styles.switcherName}>{direction.name}</span>
            </Link>
          ))}
        </div>
        <Link className={styles.switcherExit} href="/">
          Live site ↗
        </Link>
      </nav>
      <div id="concept-content">{children}</div>
    </div>
  );
}
