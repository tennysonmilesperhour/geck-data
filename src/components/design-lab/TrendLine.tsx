type TrendLineProps = {
  values: readonly number[];
  labels: readonly string[];
  className?: string;
  stroke?: string;
  fill?: string;
};

export default function TrendLine({
  values,
  labels,
  className,
  stroke = "currentColor",
  fill = "none",
}: TrendLineProps) {
  const width = 720;
  const height = 220;
  const paddingX = 12;
  const paddingY = 20;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(max - min, 1);
  const round = (value: number) => Math.round(value * 100) / 100;
  const points = values.map((value, index) => ({
    x: round(paddingX + (index / (values.length - 1)) * (width - paddingX * 2)),
    y: round(
      paddingY +
        ((max - value) / range) * (height - paddingY * 2 - 24),
    ),
    value,
    label: labels[index],
  }));
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby="design-lab-chart-title design-lab-chart-description"
      preserveAspectRatio="none"
    >
      <title id="design-lab-chart-title">Recent listing observations by day</title>
      <desc id="design-lab-chart-description">
        Counts from August 22 through August 29: {values.join(", ")}.
      </desc>
      {[0, 1, 2, 3].map((tick) => {
        const y = paddingY + tick * ((height - paddingY * 2 - 24) / 3);
        return <line key={tick} x1="0" x2={width} y1={y} y2={y} opacity="0.18" />;
      })}
      <path d={path} fill={fill} stroke={stroke} strokeWidth="4" vectorEffect="non-scaling-stroke" />
      {points.map((point) => (
        <g key={point.label}>
          <circle cx={point.x} cy={point.y} r="5" fill="currentColor" />
          <text x={point.x} y={height - 2} textAnchor="middle">
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
