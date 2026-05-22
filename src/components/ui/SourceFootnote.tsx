// One-liner that goes at the bottom of every data view, naming the
// sources that contributed and linking to the methodology page. The
// goal is "you can trust this because here's where it came from."
//
// Server-component-safe. Pass the sources as friendly labels; we
// don't try to be exhaustive, just honest.
import Link from "next/link";

export type SourceFootnoteProps = {
  /** Friendly source labels, in order of contribution weight. */
  sources?: ReadonlyArray<string>;
  /** Optional sample size to expose. */
  n?: number | null;
  /** Optional anchor in /methodology to deep-link. */
  methodologyAnchor?: string;
  /** Override the default "Sources" copy. */
  label?: string;
};

const DEFAULT_SOURCES = ["MorphMarket", "Eye in the Sky extension"];

export default function SourceFootnote({
  sources = DEFAULT_SOURCES,
  n,
  methodologyAnchor,
  label = "Sources",
}: SourceFootnoteProps) {
  const target = methodologyAnchor
    ? `/methodology#${methodologyAnchor}`
    : "/methodology";
  return (
    <footer className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-700/40 pt-3 text-[11px] text-ink-500">
      <span className="font-mono uppercase tracking-[0.14em]">{label}</span>
      <span>{sources.join(" · ")}</span>
      {n != null ? (
        <span className="font-mono tabular-nums text-ink-400">
          n={n.toLocaleString()}
        </span>
      ) : null}
      <Link
        href={target}
        className="ml-auto underline decoration-ink-700 underline-offset-2 hover:text-ink-200"
      >
        How we computed this →
      </Link>
    </footer>
  );
}
