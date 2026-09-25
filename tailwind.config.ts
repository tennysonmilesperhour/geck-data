import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Bark, charcoal and warm ivory, matched to the World Mushroom
        // Foraging "mycelial" theme (utah-forage-map DESIGN.md). Token
        // names are unchanged so every existing class shifts palette
        // without a rewrite.
        ink: {
          950: "#050404",   // page bg, near-black bark
          900: "#0b0a08",   // app bg
          850: "#15120f",   // panel bg
          800: "#1c1814",   // card bg
          750: "#262019",   // hover
          700: "#342c24",   // border strong
          650: "#40372d",   // border
          600: "#5a4d3d",   // muted border
          500: "#8a7f70",   // muted fg
          400: "#b0a697",   // dim fg
          300: "#c5bcad",   // secondary fg
          200: "#ddd4c5",   // primary fg-dim
          100: "#efe8dc",   // primary fg
          50:  "#f6f1e7",   // brightest fg, warm ivory
        },
        // /market scope. Same bark scale, a shade deeper at the bottom.
        forest: {
          975: "#020202",
          950: "#050404",
          900: "#0b0a08",
          850: "#15120f",
          800: "#1c1814",
          750: "#262019",
          700: "#342c24",
          650: "#40372d",
          600: "#5a4d3d",
          500: "#8a7f70",
          400: "#b0a697",
          300: "#c5bcad",
          200: "#ddd4c5",
          100: "#efe8dc",
          50:  "#f6f1e7",
        },
        // Primary action: pale ivory over dark text, like the forage
        // map's primary buttons. Kept under `claude` so classes compile.
        claude: {
          DEFAULT: "#dbc8a6",
          soft:    "#bca17b",
          glow:    "#efdfbf",
        },
        // Warm spore accent for eyebrows and highlights. Never a CTA.
        clay: {
          50:  "#fbf3e6",
          100: "#f5e4c9",
          200: "#efd2a8",
          300: "#e4c79c",
          400: "#dcae78",
          500: "#c9935a",
          600: "#a8773f",
          700: "#876744",
          800: "#5f4830",
          900: "#3d2e1f",
        },
        parchment: {
          50:  "#fbf5ea",
          100: "#f4e8d2",
          200: "#efdfbf",
          300: "#e1d2b7",
          400: "#d6bfa9",
        },
        // Status tokens keep their meaning in muted field tones: olive
        // sage for healthy/rising, safety amber, smoky plum for info,
        // and the forage map's soft danger red.
        ready: "#a9c79b",
        busy:  "#e0b765",
        info:  "#c4b5ce",
        danger:"#ed907e",
        // Legacy gecko tokens, existing components reference these.
        gecko: {
          DEFAULT: "#a9c79b",
          light:   "#c6ded1",
          dark:    "#7d9a70",
          accent:  "#e0b765",
        },
      },
      fontFamily: {
        // CSS variables come from src/app/layout.tsx (next/font/google).
        // Each registration falls back to a system stack so SSR + the
        // font-loading window never render with the wrong metrics.
        // De-serifed to match the Market Analytics preview, which sets every
        // heading in the sans UI face. Points at the sans variable so the
        // 43 `font-display` headings across the app render sans without an
        // edit to each one.
        display: [
          "Avenir Next",
          "Avenir",
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        sans: [
          "Avenir Next",
          "Avenir",
          "var(--font-sans)",
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "monospace",
        ],
      },
      boxShadow: {
        // Glass panels: a fine warm edge plus a faint lit top edge.
        panel: "0 0 0 1px rgba(215,193,161,0.18), inset 0 1px 0 rgba(255,245,229,0.06)",
        glow:  "0 0 0 1px rgba(239,223,191,0.35), 0 10px 35px -14px rgba(0,0,0,0.6)",
        "forest-panel":
          "0 0 0 1px rgba(215,193,161,0.18), inset 0 1px 0 rgba(255,245,229,0.06), 0 12px 40px -30px rgba(0,0,0,0.8)",
        "forest-glow":
          "0 0 0 1px rgba(239,223,191,0.35), 0 10px 35px -14px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};
export default config;
