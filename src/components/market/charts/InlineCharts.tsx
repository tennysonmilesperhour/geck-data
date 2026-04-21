"use client";
// Inline SVG chart primitives for /market Overview. Small, no external
// dependencies; the rest of the codebase uses D3 but these charts are
// cheap enough not to pull it in.
//
// AreaChart — single-series gradient area + crosshair + hover tooltip that
// follows the mouse. Built for the Market Index hero (screenshots show a
// curvy area with a year+month tooltip badge).
//
// Sparkline — tiny monotone line + gradient fill used on Top Movers rows.
import { useMemo, useRef, useState } from "react";

type Point = { t: string; v: number };

// ----------------------------------------------------------------------------
// AreaChart
// ----------------------------------------------------------------------------

const W = 800;
const H = 240;
const M = { t: 10, r: 16, b: 28, l: 40 };
const innerW = W - M.l - M.r;
const innerH = H - M.t - M.b;

export function AreaChart({
  data,
  color = "#34d399",
  yFormat = (v) => Math.round(v).toLocaleString(),
  tooltipLabel = "Index",
  height = 240,
}: {
  data: Point[];
  color?: string;
  yFormat?: (v: number) => string;
  tooltipLabel?: string;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const gradId = useMemo(
    () => `grad-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  const { xFor, yFor, linePath, areaPath, yTicks } = useMemo(() => {
    if (data.length === 0) {
      return {
        xFor: () => 0,
        yFor: () => 0,
        linePath: "",
        areaPath: "",
        yTicks: [] as number[],
      };
    }
    const vMin = Math.min(...data.map((d) => d.v));
    const vMax = Math.max(...data.map((d) => d.v));
    const pad = (vMax - vMin) * 0.1 || 1;
    const lo = Math.max(0, vMin - pad);
    const hi = vMax + pad;

    const xFor = (i: number) =>
      M.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * innerW);
    const yFor = (v: number) =>
      M.t + innerH - ((v - lo) / (hi - lo || 1)) * innerH;

    // Monotone cubic-ish smoothing via midpoint curves.
    let line = "";
    for (let i = 0; i < data.length; i++) {
      const x = xFor(i);
      const y = yFor(data[i]!.v);
      if (i === 0) {
        line = `M ${x} ${y}`;
        continue;
      }
      const px = xFor(i - 1);
      const py = yFor(data[i - 1]!.v);
      const cx1 = px + (x - px) / 2;
      const cx2 = px + (x - px) / 2;
      line += ` C ${cx1} ${py}, ${cx2} ${y}, ${x} ${y}`;
    }
    const area =
      line +
      ` L ${xFor(data.length - 1)} ${M.t + innerH}` +
      ` L ${xFor(0)} ${M.t + innerH} Z`;

    const yTicks = [lo, lo + (hi - lo) / 3, lo + (2 * (hi - lo)) / 3, hi];

    return { xFor, yFor, linePath: line, areaPath: area, yTicks };
  }, [data]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (data.length === 0 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    // Convert mouse X into viewBox X, then snap to nearest data index.
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const t = (mx - M.l) / innerW;
    const i = Math.max(0, Math.min(data.length - 1, Math.round(t * (data.length - 1))));
    setHover({ i, x: xFor(i), y: yFor(data[i]!.v) });
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-forest-500" style={{ height }}>
        No series data
      </div>
    );
  }

  const active = hover ? data[hover.i]! : null;
  const tooltipX = hover ? Math.min(Math.max(hover.x, 60), W - 110) : 0;
  const tooltipY = hover ? Math.max(M.t + 20, hover.y - 50) : 0;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height }}
      role="img"
      aria-label="Market index time series"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.38" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Y grid */}
      {yTicks.map((v, i) => {
        const y = M.t + innerH - ((v - yTicks[0]!) / (yTicks[yTicks.length - 1]! - yTicks[0]! || 1)) * innerH;
        return (
          <g key={i}>
            <line
              x1={M.l}
              x2={M.l + innerW}
              y1={y}
              y2={y}
              stroke="#1a3326"
              strokeDasharray="2 3"
              strokeWidth={1}
            />
            <text x={M.l - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#6b8a76">
              {yFormat(v)}
            </text>
          </g>
        );
      })}

      {/* Area + line */}
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />

      {/* X labels — first, middle, last */}
      {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
        <text
          key={i}
          x={xFor(i)}
          y={H - 8}
          textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
          fontSize={10}
          fill="#8ca395"
        >
          {data[i]!.t}
        </text>
      ))}

      {/* Crosshair + dot + tooltip */}
      {active && hover ? (
        <>
          <line
            x1={hover.x}
            x2={hover.x}
            y1={M.t}
            y2={M.t + innerH}
            stroke="#34d39966"
            strokeWidth={1}
          />
          <circle cx={hover.x} cy={hover.y} r={4} fill="#e5ede8" stroke={color} strokeWidth={2} />
          <g transform={`translate(${tooltipX}, ${tooltipY})`}>
            <rect
              x={-52}
              y={-32}
              width={104}
              height={40}
              rx={6}
              fill="#0b1814"
              stroke="rgba(74,222,128,0.35)"
            />
            <text x={0} y={-16} textAnchor="middle" fontSize={10} fill="#a8c4b8">
              {active.t}
            </text>
            <text x={0} y={2} textAnchor="middle" fontSize={13} fontWeight={600} fill="#e5ede8">
              {tooltipLabel}: {yFormat(active.v)}
            </text>
          </g>
        </>
      ) : null}
    </svg>
  );
}

// ----------------------------------------------------------------------------
// Sparkline — compact mood-line used on every Top Movers row.
// Autoscales; colors by sign of first→last delta so the caller doesn't
// have to thread color through.
// ----------------------------------------------------------------------------
export function Sparkline({
  values,
  width = 84,
  height = 24,
  positiveColor = "#34d399",
  negativeColor = "#fb7185",
}: {
  values: number[];
  width?: number;
  height?: number;
  positiveColor?: string;
  negativeColor?: string;
}) {
  const { path, area, color, gradId } = useMemo(() => {
    const gradId = `s-${Math.random().toString(36).slice(2, 7)}`;
    if (values.length < 2) {
      return { path: "", area: "", color: positiveColor, gradId };
    }
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    const fx = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
    const fy = (v: number) => height - 2 - ((v - lo) / span) * (height - 4);

    let p = "";
    for (let i = 0; i < values.length; i++) {
      const x = fx(i);
      const y = fy(values[i]!);
      p += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    const a = p + ` L ${fx(values.length - 1)} ${height - 1} L ${fx(0)} ${height - 1} Z`;
    const positive = values[values.length - 1]! >= values[0]!;
    return {
      path: p,
      area: a,
      color: positive ? positiveColor : negativeColor,
      gradId,
    };
  }, [values, width, height, positiveColor, negativeColor]);

  if (values.length < 2) {
    return <svg width={width} height={height} />;
  }

  return (
    <svg width={width} height={height} role="img" aria-label="Price trend">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
