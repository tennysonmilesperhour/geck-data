"use client";
// Two-thumb price-band slider that writes to the landing filter context.
// Range is anchored at [0, max] where max is rounded to a clean upper bound
// from the snapshot's p75 * 4 (so the slider covers high-end listings
// without compressing the common range into the first 10% of the track).
// Visual: thin track with two draggable thumbs, live $ readouts.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLandingFilters } from "./LandingFilters";
import { fmtUsd } from "@/lib/format";

type Props = {
  maxPrice: number; // upper bound for the slider, in USD
};

const STEP = 25;

export default function PriceBandSlider({ maxPrice }: Props) {
  const { priceBand, setPriceBand } = useLandingFilters();
  const upper = Math.max(STEP, Math.ceil(maxPrice / STEP) * STEP);

  const [localMin, setLocalMin] = useState<number>(priceBand?.[0] ?? 0);
  const [localMax, setLocalMax] = useState<number>(priceBand?.[1] ?? upper);

  // Push to context on commit (mouseup / change end) to avoid thrashing.
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      if (localMin <= 0 && localMax >= upper) {
        setPriceBand(null);
      } else {
        setPriceBand([localMin, localMax]);
      }
    }, 150);
    return () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
  }, [localMin, localMax, upper, setPriceBand]);

  const minPct = useMemo(() => (localMin / upper) * 100, [localMin, upper]);
  const maxPct = useMemo(() => (localMax / upper) * 100, [localMax, upper]);
  const isFiltered = localMin > 0 || localMax < upper;

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
          Price band
        </div>
        <div className="font-mono text-[11px] tabular-nums text-ink-200">
          {fmtUsd(localMin)} <span className="text-ink-500">→</span>{" "}
          {localMax >= upper ? `${fmtUsd(upper)}+` : fmtUsd(localMax)}
          {isFiltered ? (
            <button
              type="button"
              className="ml-3 text-xs text-ink-400 underline-offset-2 hover:text-ink-100 hover:underline"
              onClick={() => {
                setLocalMin(0);
                setLocalMax(upper);
              }}
            >
              clear
            </button>
          ) : null}
        </div>
      </div>
      <div className="relative h-2">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-ink-800" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-emerald-500/60"
          style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }}
        />
        <input
          type="range"
          min={0}
          max={upper}
          step={STEP}
          value={localMin}
          onChange={(e) =>
            setLocalMin(Math.min(Number(e.target.value), localMax - STEP))
          }
          className="absolute inset-x-0 top-0 h-2 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:cursor-grab"
          aria-label="Minimum price"
        />
        <input
          type="range"
          min={0}
          max={upper}
          step={STEP}
          value={localMax}
          onChange={(e) =>
            setLocalMax(Math.max(Number(e.target.value), localMin + STEP))
          }
          className="absolute inset-x-0 top-0 h-2 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:cursor-grab"
          aria-label="Maximum price"
        />
      </div>
    </div>
  );
}
