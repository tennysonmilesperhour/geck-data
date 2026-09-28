import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Linear-style palette in two themes. Every value is a CSS variable
        // defined in src/app/globals.css: dark on :root, light under
        // [data-theme="light"]. Dark follows Linear's own tokens (canvas
        // #08090a, surfaces #0f1011 to #18191a, hairline #23252a, ink
        // #f7f8f8 to #8a8f98, lavender #5e6ad2). Token names are unchanged
        // from earlier themes, so every class switches without edits.
        // `<alpha-value>` keeps opacity modifiers like bg-ink-900/40 working.
        ink: {
          950: "rgb(var(--ink-950) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          850: "rgb(var(--ink-850) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          750: "rgb(var(--ink-750) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          650: "rgb(var(--ink-650) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)",
          100: "rgb(var(--ink-100) / <alpha-value>)",
          50: "rgb(var(--ink-50) / <alpha-value>)",
        },
        // /market scope. Same ladder with one deeper step.
        forest: {
          975: "rgb(var(--ink-975) / <alpha-value>)",
          950: "rgb(var(--ink-950) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          850: "rgb(var(--ink-850) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          750: "rgb(var(--ink-750) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          650: "rgb(var(--ink-650) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)",
          100: "rgb(var(--ink-100) / <alpha-value>)",
          50: "rgb(var(--ink-50) / <alpha-value>)",
        },
        // The one accent: primary buttons, the selected state, focus rings,
        // link text. Buttons use white text on DEFAULT (4.7:1 in both themes).
        claude: {
          DEFAULT: "rgb(var(--claude) / <alpha-value>)",
          soft:    "rgb(var(--claude-soft) / <alpha-value>)",
          glow:    "rgb(var(--claude-glow) / <alpha-value>)",
        },
        // Secondary tint scale. Linear keeps a single hue, so the old warm
        // accent now runs through lavender tints.
        clay: {
          50: "rgb(var(--clay-50) / <alpha-value>)",
          100: "rgb(var(--clay-100) / <alpha-value>)",
          200: "rgb(var(--clay-200) / <alpha-value>)",
          300: "rgb(var(--clay-300) / <alpha-value>)",
          400: "rgb(var(--clay-400) / <alpha-value>)",
          500: "rgb(var(--clay-500) / <alpha-value>)",
          600: "rgb(var(--clay-600) / <alpha-value>)",
          700: "rgb(var(--clay-700) / <alpha-value>)",
          800: "rgb(var(--clay-800) / <alpha-value>)",
          900: "rgb(var(--clay-900) / <alpha-value>)",
        },
        parchment: {
          50: "rgb(var(--clay-50) / <alpha-value>)",
          100: "rgb(var(--clay-100) / <alpha-value>)",
          200: "rgb(var(--clay-200) / <alpha-value>)",
          300: "rgb(var(--clay-300) / <alpha-value>)",
          400: "rgb(var(--clay-400) / <alpha-value>)",
        },
        // Status. Rising and under market use lavender, over market and
        // warnings use amber at matched lightness, errors use red. Blue
        // against warm stays distinct for red-green color blindness.
        ready:  "rgb(var(--ready) / <alpha-value>)",
        busy:   "rgb(var(--busy) / <alpha-value>)",
        info:   "rgb(var(--info) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        // Legacy gecko tokens, still referenced by a few components.
        gecko: {
          DEFAULT: "rgb(var(--claude-glow) / <alpha-value>)",
          light:   "rgb(var(--clay-300) / <alpha-value>)",
          dark:    "rgb(var(--claude) / <alpha-value>)",
          accent:  "rgb(var(--busy) / <alpha-value>)",
        },
      },
      fontFamily: {
        // CSS variables come from src/app/layout.tsx (next/font/google).
        // Each registration falls back to a system stack so SSR + the
        // font-loading window never render with the wrong metrics.
        // Headings use the same sans face as body text, like Linear. Points
        // at the sans variable so every `font-display` heading renders sans
        // without an edit to each one.
        display: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
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
        // Linear lifts panels with a hairline and a faint top edge instead
        // of drop shadows. The edge value changes per theme (globals.css).
        edge:  "var(--shadow-edge)",
        panel: "0 0 0 1px rgb(var(--ink-700)), var(--shadow-edge)",
        glow:  "0 0 0 1px rgba(94,106,210,0.45), 0 8px 30px -12px rgba(94,106,210,0.35)",
        "forest-panel":
          "0 0 0 1px rgb(var(--ink-700)), var(--shadow-lift)",
        "forest-glow":
          "0 0 0 1px rgba(94,106,210,0.45), 0 8px 30px -12px rgba(94,106,210,0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
