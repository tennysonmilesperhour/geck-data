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
          // Retuned to the Geck Inspect "Market Analytics" slate scale so
          // GeckIntellect reads as the same product surface. Token names are
          // unchanged; only the values moved from forest green to slate, so
          // every existing class shifts palette without a rewrite.
          950: "#020617",   // page bg — slate-950
          900: "#0a1120",   // app bg — lifted slate
          850: "#0f172a",   // panel bg — slate-900
          800: "#131d31",   // card bg — slate-900/lifted
          750: "#1a2438",   // hover
          700: "#1e293b",   // border strong — slate-800
          650: "#273349",   // border
          600: "#334155",   // muted border — slate-700
          500: "#64748b",   // muted fg — slate-500
          400: "#94a3b8",   // dim fg — slate-400
          300: "#cbd5e1",   // secondary fg — slate-300
          200: "#e2e8f0",   // primary fg-dim — slate-200
          100: "#f1f5f9",   // primary fg — slate-100
          50:  "#f8fafc",   // brightest fg — slate-50
        },
        // /market layers the deeper "forest" tones on top. Mirrors
        // ink-* so per-surface search-and-replace stays clean.
        forest: {
          // /market scope. Same slate scale as ink, a shade deeper at the
          // bottom so the dashboard reads a touch darker than the rest of
          // the app, matching the Market Analytics panel ground.
          975: "#010409",   // deepest wash
          950: "#020617",
          900: "#0a1120",
          850: "#0f172a",   // forest-surface bg — slate-900
          800: "#131d31",
          750: "#1a2438",
          700: "#1e293b",
          650: "#273349",
          600: "#334155",
          500: "#64748b",
          400: "#94a3b8",
          300: "#cbd5e1",
          200: "#e2e8f0",
          100: "#f1f5f9",
          50:  "#f8fafc",
        },
        // Primary CTA / accent. Slightly more pigment than the
        // previous flat emerald so it reads as a chosen ink rather
        // than a Tailwind default. Kept under `claude` so the rest of
        // the codebase compiles unchanged.
        claude: {
          // Primary accent, retuned to the Market Analytics emerald so the
          // CTA / link / highlight colour matches the preview exactly.
          DEFAULT: "#10b981",  // emerald-500
          soft:    "#059669",  // emerald-600
          glow:    "#34d399",  // emerald-400 — hover / focus / link text
        },
        // Warm terracotta — the field-guide accent. Used for "rising"
        // momentum, important highlights, and ornament strokes. NOT a
        // CTA color; pair with emerald for primary actions.
        clay: {
          // Warm accent, retuned from terracotta to the Market Analytics
          // amber. Used for eyebrows, "preview" notes and warm highlights;
          // never a CTA. Kept under `clay` so existing classes compile.
          50:  "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",   // amber-300 — eyebrow text
          400: "#fbbf24",   // amber-400
          500: "#f59e0b",   // amber-500 — primary
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },
        // Parchment cream — for paper-warm highlights, tooltip
        // surfaces, ornamental hairlines. Use sparingly.
        parchment: {
          // Highlight surface, retuned to soft amber so warm accents read
          // against the slate ground instead of as printed cream.
          50:  "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
        },
        // Status tokens. `ready` (sage) keeps the field-guide warmth.
        // `busy` shifts toward clay so amber doesn't compete with the
        // primary accent.
        ready: "#34d399",     // emerald-400 — healthy / rising
        busy:  "#f59e0b",     // amber-500 — attention / degraded
        info:  "#38bdf8",     // sky-400 — informational / scraped source
        danger:"#f87171",     // red-400 — error / falling
        // Legacy gecko tokens — existing components reference these.
        gecko: {
          DEFAULT: "#34d399",  // emerald-400
          light:   "#6ee7b7",  // emerald-300
          dark:    "#059669",  // emerald-600
          accent:  "#f59e0b",  // amber-500
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
        // Panels in the preview are a flat slate card with a hairline ring,
        // no atmospheric glow. `panel` is that ring; `glow` stays emerald for
        // the rare focused/elevated element.
        panel: "0 0 0 1px rgba(30,41,59,0.8)",
        glow:  "0 0 0 1px rgba(16,185,129,0.35), 0 8px 30px -12px rgba(16,185,129,0.30)",
        "forest-panel":
          "0 0 0 1px rgba(30,41,59,0.8), 0 12px 40px -30px rgba(2,6,23,0.8)",
        "forest-glow":
          "0 0 0 1px rgba(16,185,129,0.35), 0 8px 30px -12px rgba(16,185,129,0.30)",
      },
    },
  },
  plugins: [],
};
export default config;
