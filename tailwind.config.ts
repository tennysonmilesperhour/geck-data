import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Claude Code-inspired palette
        ink: {
          950: "#0f0f0f",   // deepest bg
          900: "#141414",   // app bg
          850: "#191919",   // panel bg
          800: "#1f1f1f",   // card bg
          750: "#262626",   // hover
          700: "#2d2d2d",   // border strong
          650: "#363636",   // border
          600: "#4a4a4a",   // muted border
          500: "#6b6b6b",   // muted fg
          400: "#8a8a8a",   // dim fg
          300: "#a8a8a8",   // secondary fg
          200: "#c7c7c7",   // primary fg-dim
          100: "#e4e4e4",   // primary fg
          50:  "#f5f5f5",   // brightest fg
        },
        // Claude signature orange used sparingly
        claude: {
          DEFAULT: "#d97757",
          soft: "#c06a4a",
          glow: "#e88962",
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
        panel: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 0 0 1px rgba(255,255,255,0.04)",
        glow:  "0 0 0 1px rgba(217,119,87,0.35), 0 8px 30px -12px rgba(217,119,87,0.3)",
      },
    },
  },
  plugins: [],
};
export default config;
