// Shared D3 chart palette. Keys are stable, every chart imports from
// here so the aesthetic stays coherent. Tuned to the World Mushroom
// Foraging "mycelial" palette (see tailwind.config.ts and globals.css):
// spore tan primary, smoky plum info, safety amber warn, bark chrome.
export const chartTheme = {
  // Primary & accent
  primary: "#e4c79c",         // spore tan
  primarySoft: "rgba(228,199,156,0.22)",
  secondary: "#c4b5ce",       // smoky plum, info / scraped
  secondarySoft: "rgba(196,181,206,0.22)",
  positive: "#a9c79b",        // sage olive, rising
  negative: "#ed907e",        // soft red, falling
  warn:     "#e0b765",        // safety amber
  // Series palette (use in order). Muted field hues that stay distinct
  // on a bark ground without any one dominating.
  series: [
    "#e4c79c",  // spore tan
    "#a9c79b",  // sage olive
    "#c4b5ce",  // smoky plum
    "#9fb4c7",  // dusk blue
    "#e7a58d",  // clay rose
    "#c6ded1",  // pale sage
    "#a99bc0",  // lavender
    "#d6bfa9",  // bark
  ],
  // Chart chrome, bark scale matched to the dashboard panels.
  grid: "#342c24",
  axis: "#5a4d3d",
  axisText: "#b0a697",
  label: "#c5bcad",
  markerStroke: "#050404",
  tooltipBg: "#15120f",
  tooltipBorder: "#40372d",
};
