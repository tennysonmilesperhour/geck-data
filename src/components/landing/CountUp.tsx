"use client";
// Small client-only number ticker. Counts from 0 to `to` over `duration` ms
// using requestAnimationFrame with an ease-out curve so KPI tiles feel
// "alive" on first paint without being distracting.
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
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      setValue(easeOutCubic(t) * to);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [to, duration]);

  return <span className={className}>{format(value)}</span>;
}
