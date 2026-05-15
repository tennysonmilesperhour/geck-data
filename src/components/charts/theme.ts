// Shared D3 chart palette. Keys are stable — every chart imports from
// here so the aesthetic stays coherent. Anchored to the
// naturalist field-guide tokens defined in tailwind.config.ts and
// globals.css: moss (primary), clay (warm accent), ocean (info),
// sage / softened red for positive / negative status.
export const chartTheme = {
  // Primary & accent
  primary: "#0e9a73",         // moss / claude.DEFAULT
  primarySoft: "rgba(14,154,115,0.22)",
  secondary: "#7ab1d1",       // muted ocean
  secondarySoft: "rgba(122,177,209,0.22)",
  positive: "#7bbf83",        // sage — ready status
  negative: "#d76d62",        // softened red — danger
  warn:     "#cd6e3c",        // clay-400 — warmer than amber
  // Series palette (use in order)
  series: [
    "#0e9a73",  // moss primary
    "#7ab1d1",  // ocean
    "#b25929",  // clay-500
    "#7bbf83",  // sage
    "#bda255",  // parchment-400 (mustard)
    "#a78bfa",  // soft violet
    "#2dbf95",  // moss glow
    "#d76d62",  // softened red
  ],
  // Chart chrome — tuned for the deeper field-guide surfaces
  grid: "#193428",            // ink-750
  axis: "#447256",            // ink-600
  axisText: "#aebfb5",        // ink-300
  label: "#cdd7d0",           // ink-200
  markerStroke: "#070f0b",    // ink-950 — dot outlines blend into page
  tooltipBg: "#13261d",       // ink-800
  tooltipBorder: "#2e5645",   // ink-650
};
