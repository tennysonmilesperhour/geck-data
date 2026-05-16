// Combo / morph term renderer. Drops a dotted underline + hover-popover
// on any term the glossary recognises; everything else renders as plain
// text. CSS-only popover (group hover/focus) so it works in server
// components and respects keyboard focus on the trigger.
//
// Typical usage:
//   <MorphTerm name="Lilly White × Pinstripe" />
//   <MorphTerm name="Cappuccino" />
import { lookupMorph, splitComboParts } from "@/lib/morphs/glossary";

export default function MorphTerm({
  name,
  className = "",
}: {
  name: string | null | undefined;
  className?: string;
}) {
  if (!name) return null;
  const parts = splitComboParts(name);
  // Preserve the original separator string between parts. We re-derive
  // it by finding non-token substrings in the original — but for the
  // simple set of separators (× / x / + / /) the visual cost of
  // normalising to " × " is negligible and improves consistency. Keep
  // a join character that hints at compound meaning.
  return (
    <span className={className}>
      {parts.map((part, idx) => {
        const entry = lookupMorph(part);
        const isLast = idx === parts.length - 1;
        return (
          <span key={`${part}-${idx}`}>
            {entry ? <Glossed name={part} description={entry.description} /> : part}
            {!isLast ? <span className="text-ink-500"> × </span> : null}
          </span>
        );
      })}
    </span>
  );
}

function Glossed({
  name,
  description,
}: {
  name: string;
  description: string;
}) {
  return (
    <span
      tabIndex={0}
      className="group relative inline cursor-help underline decoration-dotted decoration-ink-500 underline-offset-[3px] outline-none transition hover:decoration-claude-glow focus-visible:decoration-claude-glow"
      aria-label={`${name}: ${description}`}
    >
      {name}
      {/*
        Popover. Positioned below the term, max-width capped so long
        descriptions wrap. group-hover + group-focus-within so the
        popover opens on hover OR keyboard focus. Pointer-events: none
        on the inactive state keeps it from intercepting clicks.
      */}
      <span
        role="tooltip"
        // z-50: sit above siblings that establish stacking contexts via
        // `transform`, `filter`, `will-change`, or `position: relative` +
        // a z-index. The previous z-20 was getting beaten by inline
        // sparkline filters / gradient layers on the same page.
        className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-72 normal-case rounded-lg border border-ink-700 bg-ink-900/95 p-3 text-left text-xs font-normal leading-relaxed tracking-normal text-ink-200 shadow-glow backdrop-blur transition group-hover:block group-focus-within:block"
      >
        <span className="block font-display text-[13px] font-medium text-ink-50">
          {name}
        </span>
        <span className="mt-1 block text-ink-300">{description}</span>
      </span>
    </span>
  );
}
