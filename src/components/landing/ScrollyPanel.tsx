"use client";
// One narrated panel in the scrollytelling section. Header + description on
// the left, visualization on the right. Fades + slides into view via
// IntersectionObserver. Pairs of text+viz alternate sides as you scroll so
// the page has rhythm.
import { useEffect, useRef, useState } from "react";

type Props = {
  eyebrow: string;
  title: string;
  description: React.ReactNode;
  viz: React.ReactNode;
  reverse?: boolean;
};

export default function ScrollyPanel({
  eyebrow,
  title,
  description,
  viz,
  reverse,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const el = ref.current;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      className={`grid grid-cols-1 gap-6 transition-all duration-700 ease-out lg:grid-cols-2 lg:gap-10 ${
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-6 opacity-0"
      }`}
    >
      <div className={`${reverse ? "lg:order-2" : ""} flex flex-col justify-center`}>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400/80">
          {eyebrow}
        </div>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-ink-50 md:text-3xl">
          {title}
        </h3>
        <div className="mt-3 max-w-md text-sm leading-6 text-ink-300">
          {description}
        </div>
      </div>
      <div className={reverse ? "lg:order-1" : ""}>
        <div className="rounded-2xl border border-ink-700 bg-ink-850 p-4 shadow-panel">
          {viz}
        </div>
      </div>
    </section>
  );
}
