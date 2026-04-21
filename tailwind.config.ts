import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Site-wide dark palette. Backgrounds (950..650) carry a subtle
        // emerald tint to match the forest identity; text tones (500..50)
        // stay near-neutral so content remains readable against any
        // accent color. /market layers stronger forest-* surfaces on top
        // for its dedicated look.
        ink: {
          950: "#0a1410",   // deepest bg
          900: "#0d1814",   // app bg
          850: "#112019",   // panel bg
          800: "#15281f",   // card bg
          750: "#1a3326",   // hover
          700: "#233f2f",   // border strong
          650: "#2c4f3a",   // border
          600: "#426752",   // muted border
          500: "#6b7b71",   // muted fg (slight tint)
          400: "#8a988f",   // dim fg
          300: "#a8b5ac",   // secondary fg
          200: "#c7d0ca",   // primary fg-dim
          100: "#e4e8e6",   // primary fg
          50:  "#f5f7f5",   // brightest fg
        },
        // Green-tinted dark palette used by /market. Mirrors ink-* so we
        // can do a straight search/replace per surface.
        forest: {
          975: "#060d0a",   // page bg (deeper than 950)
          950: "#081210",   // deepest bg
          900: "#0b1814",   // app bg
          850: "#0e2019",   // panel bg
          800: "#12281f",   // card bg
          750: "#193526",   // hover
          700: "#204030",   // border strong
          650: "#2a523d",   // border
          600: "#3a6b52",   // muted border
          500: "#568b70",   // muted fg
          400: "#81a896",   // dim fg
          300: "#a8c4b8",   // secondary fg
          200: "#c9dad1",   // primary fg-dim
          100: "#e5ede8",   // primary fg
          50:  "#f5faf7",   // brightest fg
        },
        // Primary CTA / accent. Kept under the `claude` namespace so
        // existing components continue to compile without touching every
        // usage — the underlying hues are emerald now to match the
        // market screenshots' consistent green identity.
        claude: {
          DEFAULT: "#10b981",
          soft: "#059669",
          glow: "#34d399",
        },
        // Status tokens
        ready: "#4ade80",     // ready/online green
        busy:  "#fbbf24",      // processing amber
        info:  "#60a5fa",      // info blue
        danger:"#f87171",      // negative
        // Keep legacy gecko tokens so existing components compile
        gecko: {
          DEFAULT: "#4ade80",
          light: "#86efac",
          dark: "#22c55e",
          accent: "#d97757",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Inter",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "monospace"],
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
