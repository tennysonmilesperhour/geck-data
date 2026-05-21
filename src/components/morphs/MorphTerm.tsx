"use client";
// Combo / morph term renderer. Drops a dotted underline + hover-popover
// on any term the glossary recognises; everything else renders as plain
// text. Wraps the page in a tiny context so only ONE tooltip is visible
// at a time — the previous CSS-only group-hover + group-focus-within
// approach let a keyboard-focused term stay open while a neighbour got
// hovered, producing the overlapping tooltips reported on /pulse.
//
// Typical usage:
//   <MorphTerm name="Lilly White × Pinstripe" />
//   <MorphTerm name="Cappuccino" />
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import { lookupMorph, splitComboParts } from "@/lib/morphs/glossary";

type ActiveCtx = {
  active: string | null;
  setActive: (id: string | null) => void;
};
// A context with a working default lets MorphTerm work outside a provider
// (e.g., in unit-test renders) — the singleton state just lives at the
// document root level.
const ActiveTooltip = createContext<ActiveCtx>({
  active: null,
  setActive: () => {},
});

export function MorphTermProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const value = useMemo(() => ({ active, setActive }), [active]);
  return <ActiveTooltip.Provider value={value}>{children}</ActiveTooltip.Provider>;
}

export default function MorphTerm({
  name,
  className = "",
}: {
  name: string | null | undefined;
  className?: string;
}) {
  if (!name) return null;
  const parts = splitComboParts(name);
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

function Glossed({ name, description }: { name: string; description: string }) {
  const id = useId();
  const { active, setActive } = useContext(ActiveTooltip);
  const isOpen = active === id;

  const open = useCallback(() => setActive(id), [id, setActive]);
  const close = useCallback(() => {
    // Only clear if we are still the active tooltip — protects against a
    // mouseleave on the previous trigger racing past a mouseenter on the
    // new one and accidentally closing the new tooltip.
    if (active === id) setActive(null);
  }, [active, id, setActive]);

  return (
    <span
      className="relative inline cursor-help underline decoration-dotted decoration-ink-500 underline-offset-[3px] outline-none transition hover:decoration-claude-glow focus-visible:decoration-claude-glow"
      aria-label={`${name}: ${description}`}
      tabIndex={0}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {name}
      <span
        role="tooltip"
        // z-50 keeps the popover above sparkline filters / gradient overlays.
        // pointer-events-none so the popover never intercepts a hover/click
        // that should reach the trigger or its siblings.
        className={
          "pointer-events-none absolute left-0 top-full z-50 mt-2 w-72 normal-case rounded-lg border border-ink-700 bg-ink-900/95 p-3 text-left text-xs font-normal leading-relaxed tracking-normal text-ink-200 shadow-glow backdrop-blur " +
          (isOpen ? "block" : "hidden")
        }
      >
        <span className="block font-display text-[13px] font-medium text-ink-50">
          {name}
        </span>
        <span className="mt-1 block text-ink-300">{description}</span>
      </span>
    </span>
  );
}
