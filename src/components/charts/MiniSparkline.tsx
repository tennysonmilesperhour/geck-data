// Tiny inline sparkline. Used everywhere we want to show a 14-day
// trend next to a label without dropping into a full chart panel.
// Pure SVG, no dependencies, safe in server or client components.
//
// Slope semantics match the trait-activity panel on /trends:
//   rising  : late half count >=20% higher than early half  -> moss
//   cooling : late half <=20% lower than early              -> red
//   new     : early half = 0, late >= 2                     -> ocean
//   flat    : everything else                                -> grey
//
// Caller can override the color by passing `color`; otherwise the
// slope-derived tone applies.

export type SlopeKind = "rising" | "cooling" | "new" | "flat";

export function classifySlope(early: number, late: number): SlopeKind {
  if (early === 0 && late >= 2) return "new";
  if (early === 0) return "flat";
  const ratio = (late - early) / early;
  if (ratio >= 0.2) return "rising";
  if (ratio <= -0.2) return "cooling";
  return "flat";
}

export function slopeOf(daily: ReadonlyArray<number>): SlopeKind {
  const half = Math.floor(daily.length / 2);
  let early = 0;
  let late = 0;
  for (let i = 0; i < daily.length; i++) {
    if (i < half) early += daily[i] ?? 0;
    else late += daily[i] ?? 0;
  }
  return classifySlope(early, late);
}

const SLOPE_COLOR: Record<SlopeKind, string> = {
  rising:  "#2dbf95", // claude.glow
  cooling: "#d76d62", // danger
  new:     "#7ab1d1", // info ocean
  flat:    "#6c8675", // ink-500
};

export default function MiniSparkline({
  values,
  width = 88,
  height = 22,
  color,
  fill = false,
}: {
  values: ReadonlyArray<number>;
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  if (values.length < 2) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const peak = Math.max(1, ...values);
  const slope = slopeOf(values);
  const stroke = color ?? SLOPE_COLOR[slope];

  const stepX = (width - 2) / (values.length - 1);
  let line = "";
  for (let i = 0; i < values.length; i++) {
    const x = 1 + i * stepX;
    const y = height - 1 - (values[i]! / peak) * (height - 2);
    line += `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
  }

  const area = fill
    ? `${line} L ${(1 + (values.length - 1) * stepX).toFixed(2)} ${height - 1} L 1 ${height - 1} Z`
    : "";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="shrink-0"
    >
      {fill ? (
        <path d={area} fill={stroke} opacity={0.16} />
      ) : null}
      <path
        d={line.trim()}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    </svg>
  );
}
