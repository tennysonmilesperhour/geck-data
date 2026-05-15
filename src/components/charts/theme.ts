// Shared D3 chart palette. Keys are stable — every chart imports from
// here so the aesthetic stays coherent. Anchor is `--accent` from
// globals.css (emerald-bright) so charts read on the same brand as the
// rest of the app. Sky-blue is the secondary so two-series overlays
// have enough hue separation; positive/negative/warn track the status
// tokens defined in tailwind.config.ts.
export const chartTheme = {
  // Primary & accent
  primary: "#10b981",      // emerald — same as claude.DEFAULT
  primarySoft: "rgba(16,185,129,0.22)",
  secondary: "#60a5fa",    // info blue (overlays / secondary series)
  secondarySoft: "rgba(96,165,250,0.22)",
  positive: "#4ade80",
  negative: "#f87171",
  warn: "#fbbf24",
  // Series palette (use in order)
  series: [
    "#10b981", // emerald primary
    "#60a5fa", // info blue
    "#34d399", // mint
    "#fbbf24", // amber
    "#a78bfa", // purple
    "#f472b6", // pink
    "#4ade80", // bright green
    "#f87171", // danger red
  ],
  // Chart chrome — tuned for the forest dark surfaces
  grid: "#1f3328",         // ink-800 / forest-800 territory
  axis: "#426752",         // ink-600 / forest-600
  axisText: "#a8b5ac",     // ink-300
  label: "#c7d0ca",        // ink-200
  markerStroke: "#0a1410", // ink-950 — dot outlines blend into panel
  tooltipBg: "#15281f",    // ink-800
  tooltipBorder: "#2c4f3a",// ink-650
};
