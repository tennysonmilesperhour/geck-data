import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Naturalist field-guide palette. Backgrounds are deeper and
        // more saturated than the previous low-chroma greys, so the
        // hierarchy actually reads on a dark surface. Text tones stay
        // near-neutral but with a faint green warmth.
        ink: {
          950: "#070f0b",   // page bg — deepest forest
          900: "#0a1611",   // app bg
          850: "#0e1d17",   // panel bg
          800: "#13261d",   // card bg
          750: "#193428",   // hover
          700: "#234436",   // border strong
          650: "#2e5645",   // border
          600: "#447256",   // muted border
          500: "#6c8675",   // muted fg
          400: "#8ea69a",   // dim fg
          300: "#aebfb5",   // secondary fg
          200: "#cdd7d0",   // primary fg-dim
          100: "#e6ece8",   // primary fg
          50:  "#f4f7f5",   // brightest fg
        },
        // /market layers the deeper "forest" tones on top. Mirrors
        // ink-* so per-surface search-and-replace stays clean.
        forest: {
          975: "#040a07",   // deepest bg (below 950 — used as page wash)
          950: "#060f0b",
          900: "#091611",
          850: "#0c1d17",
          800: "#10261d",
          750: "#163627",
          700: "#1f4231",
          650: "#2b5440",
          600: "#3e7055",
          500: "#5b8975",
          400: "#86a99a",
          300: "#aec4ba",
          200: "#cddcd3",
          100: "#e7ede9",
          50:  "#f4faf6",
        },
        // Primary CTA / accent. Slightly more pigment than the
        // previous flat emerald so it reads as a chosen ink rather
        // than a Tailwind default. Kept under `claude` so the rest of
        // the codebase compiles unchanged.
        claude: {
          DEFAULT: "#0e9a73",  // moss / deep emerald
          soft:    "#076c50",
          glow:    "#2dbf95",  // hover / focus glow
        },
        // Warm terracotta — the field-guide accent. Used for "rising"
        // momentum, important highlights, and ornament strokes. NOT a
        // CTA color; pair with emerald for primary actions.
        clay: {
          50:  "#fbeee5",
          100: "#f5d9c6",
          200: "#e9b394",
          300: "#dc8c63",
          400: "#cd6e3c",
          500: "#b25929",   // primary clay
          600: "#8e4521",
          700: "#6b341a",
          800: "#492311",
          900: "#2a1409",
        },
        // Parchment cream — for paper-warm highlights, tooltip
        // surfaces, ornamental hairlines. Use sparingly.
        parchment: {
          50:  "#fbf6e8",
          100: "#f5ecd0",
          200: "#ead9a5",
          300: "#d9c180",
          400: "#bda255",
        },
        // Status tokens. `ready` (sage) keeps the field-guide warmth.
        // `busy` shifts toward clay so amber doesn't compete with the
        // primary accent.
        ready: "#7bbf83",     // sage / leaf green
        busy:  "#cd6e3c",     // clay-400, warmer than amber
        info:  "#7ab1d1",     // muted ocean
        danger:"#d76d62",     // softened red — fits the warm palette
        // Legacy gecko tokens — existing components reference these.
        gecko: {
          DEFAULT: "#7bbf83",
          light:   "#a8d2af",
          dark:    "#4b8c5b",
          accent:  "#b25929", // clay-500
        },
      },
      fontFamily: {
        // CSS variables come from src/app/layout.tsx (next/font/google).
        // Each registration falls back to a system stack so SSR + the
        // font-loading window never render with the wrong metrics.
        display: [
          "var(--font-display)",
          "ui-serif",
          "Iowan Old Style",
          "Apple Garamond",
          "Georgia",
          "serif",
        ],
        sans: [
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
        panel: "0 1px 0 0 rgba(74,222,128,0.02) inset, 0 0 0 1px rgba(74,222,128,0.05)",
        glow:  "0 0 0 1px rgba(16,185,129,0.35), 0 8px 30px -12px rgba(16,185,129,0.35)",
        // Stronger emerald inner border used on /market panels.
        "forest-panel":
          "0 1px 0 0 rgba(74,222,128,0.03) inset, 0 0 0 1px rgba(74,222,128,0.06), 0 12px 40px -28px rgba(16,185,129,0.35)",
        "forest-glow":
          "0 0 0 1px rgba(74,222,128,0.35), 0 8px 30px -12px rgba(16,185,129,0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
