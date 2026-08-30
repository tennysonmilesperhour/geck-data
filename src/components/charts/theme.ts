// Shared D3 chart palette. Keys are stable — every chart imports from
// here so the aesthetic stays coherent. Retuned to the Geck Inspect
// "Market Analytics" slate/emerald palette (see tailwind.config.ts and
// globals.css): emerald primary, sky info, amber warn, slate chrome.
export const chartTheme = {
  // Primary & accent
  primary: "#34d399",         // emerald-400 — matches the preview area charts
  primarySoft: "rgba(52,211,153,0.22)",
  secondary: "#38bdf8",       // sky-400 — info / scraped
  secondarySoft: "rgba(56,189,248,0.22)",
  positive: "#34d399",        // emerald-400 — rising
  negative: "#f87171",        // red-400 — falling
  warn:     "#f59e0b",        // amber-500
  // Series palette (use in order). Distinct hues chosen to read on a slate
  // ground without any one dominating.
  series: [
    "#34d399",  // emerald
    "#38bdf8",  // sky
    "#f59e0b",  // amber
    "#a78bfa",  // violet
    "#fb7185",  // rose
    "#2dd4bf",  // teal
    "#818cf8",  // indigo
    "#a3e635",  // lime
  ],
  // Chart chrome — slate, matched to the dashboard panels.
  grid: "#1e293b",            // slate-800
  axis: "#334155",            // slate-700
  axisText: "#94a3b8",        // slate-400
  label: "#cbd5e1",           // slate-300
  markerStroke: "#020617",    // slate-950 — dot outlines blend into page
  tooltipBg: "#0f172a",       // slate-900
  tooltipBorder: "#1e293b",   // slate-800
};
