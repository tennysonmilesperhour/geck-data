// Shared chart color and stroke rules.
//
// Series colors are sampled from one gradient between two theme colors
// (--series-a and --series-b in globals.css), so several lines on a chart
// read as one family instead of unrelated hues. Lines are direct-labeled,
// so color never carries identity alone. Single-series lines use the same
// gradient along their length.

/** The i-th of n colors sampled evenly from the series gradient. */
export function seriesColor(i: number, n: number): string {
  if (n <= 1) return "rgb(var(--series-a))";
  const t = Math.round((i / (n - 1)) * 100);
  return `color-mix(in oklch, rgb(var(--series-b)) ${t}%, rgb(var(--series-a)))`;
}

/** Stroke settings for every data line: thin, crisp ends. */
export const LINE = {
  fill: "none",
  strokeWidth: 1.5,
  strokeLinejoin: "round" as const,
  strokeLinecap: "butt" as const,
};

/**
 * SVG gradient defs, in chart coordinates so a perfectly flat line still
 * renders (a bounding-box gradient on a zero-height line draws nothing).
 * `line` runs left to right, dim to bright, so the most recent point
 * carries the most weight. `area` fades a fill from the line color down.
 */
export function SeriesDefs({
  id,
  x1,
  x2,
  y1,
  y2,
}: {
  id: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}) {
  return (
    <defs>
      <linearGradient id={`${id}-line`} gradientUnits="userSpaceOnUse" x1={x1} y1={0} x2={x2} y2={0}>
        <stop offset="0" stopColor="rgb(var(--series-b))" />
        <stop offset="1" stopColor="rgb(var(--series-a))" />
      </linearGradient>
      <linearGradient id={`${id}-area`} gradientUnits="userSpaceOnUse" x1={0} y1={y1} x2={0} y2={y2}>
        <stop offset="0" stopColor="rgb(var(--series-a))" stopOpacity="0.22" />
        <stop offset="1" stopColor="rgb(var(--series-a))" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}
