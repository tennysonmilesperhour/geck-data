// Shared D3 chart palette, tuned for the Claude-Code-style dark surface
// (ink-800 panel background). Keep these keys stable — all charts import
// from here so the aesthetic stays coherent.
export const chartTheme = {
  // Primary & accent
  primary: "#d97757",      // Claude orange (bars / fills)
  primarySoft: "rgba(217,119,87,0.22)",
  secondary: "#60a5fa",    // info blue (overlays / secondary series)
  secondarySoft: "rgba(96,165,250,0.22)",
  positive: "#4ade80",
  negative: "#f87171",
  warn: "#fbbf24",
  // Series palette (use in order)
  series: [
    "#d97757", // claude
    "#60a5fa", // info
    "#4ade80", // ready
    "#fbbf24", // busy
    "#a78bfa", // purple
    "#f472b6", // pink
    "#34d399", // teal
    "#f87171", // danger
  ],
  // Chart chrome
  grid: "#2d2d2d",
  axis: "#4a4a4a",
  axisText: "#a8a8a8",
  label: "#c7c7c7",
  markerStroke: "#0f0f0f", // dot outlines blend into panel bg
  tooltipBg: "#1f1f1f",
  tooltipBorder: "#363636",
};
