"use client";
// Small number ticker for the KPI tiles.
//
// The value it renders on the server, and on the very first client render, is
// the real final number. It used to seed state at 0 and climb, which meant the
// static HTML, every crawler, and any visitor without JS read "$0" and "0" as
// the answer, and even with JS the intermediate frames ($22, $32, $75) were
// visible long enough to be mistaken for the figure. So the animation is now
// strictly an enhancement: it runs only when `to` actually changes after mount,
// and it moves between two real values instead of up from a fake zero.
import { useEffect, useRef, useState } from "react";

type Props = {
  to: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export default function CountUp({
  to,
  duration = 900,
  format = (n) => Math.round(n).toLocaleString(),
  className,
}: Props) {
  // useState's initial value is what the server serialises into the HTML, so
  // seeding it with `to` is what puts the true number in the static markup.
  const [value, setValue] = useState(to);
  // Mirrors what is on screen, so a mid-flight change of `to` picks up from
  // the frame the visitor can see rather than snapping backwards.
  const shownRef = useRef(to);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = shownRef.current;
    // First mount lands here with from === to: the tile is already correct and
    // there is nothing worth animating.
    if (from === to) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      shownRef.current = to;
      setValue(to);
      return;
    }

    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const next = from + (to - from) * easeOutCubic(t);
      shownRef.current = next;
      setValue(next);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [to, duration]);

  return <span className={className}>{format(value)}</span>;
}
