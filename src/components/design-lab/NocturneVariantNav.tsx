import Link from "next/link";
import styles from "./nocturne-variants.module.css";

const VARIANTS = [
  { href: "/design-lab/nocturne", number: "03", label: "Base" },
  { href: "/design-lab/nocturne/ledger", number: "A", label: "Ledger" },
  { href: "/design-lab/nocturne/plot", number: "B", label: "Plot" },
  { href: "/design-lab/nocturne/story", number: "C", label: "Scroll" },
  { href: "/design-lab/nocturne/atlas", number: "D", label: "Atlas" },
] as const;

type NocturneVariantNavProps = {
  active: "base" | "ledger" | "plot" | "story" | "atlas";
};

export default function NocturneVariantNav({ active }: NocturneVariantNavProps) {
  return (
    <nav className={styles.variantNav} aria-label="Nocturne variations">
      <p>03 / Nocturne studies</p>
      <div>
        {VARIANTS.map((variant) => {
          const key = variant.label.toLowerCase();
          return (
            <Link
              key={variant.href}
              href={variant.href}
              aria-current={active === key ? "page" : undefined}
            >
              <span>{variant.number}</span>
              {variant.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
