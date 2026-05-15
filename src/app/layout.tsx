import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import ErrorBoundary from "@/components/ErrorBoundary";
import TelemetryClient from "@/components/TelemetryClient";

// Typography. The pairing follows the UI Pro Max "Dashboard Data"
// recommendation for analytics-first products, swapped to keep our
// editorial display face on top:
//
//   Display — Fraunces (variable serif, opsz/SOFT/WONK axes)
//             Anchors page titles with character that no analytics
//             template ships with by default.
//
//   Body    — IBM Plex Sans (300/400/500/600/700)
//             Replaces Inter. Plex is purpose-built for data UI:
//             slightly humanist, tabular figures, identifiable in
//             screenshots, and unmistakably *not* a default
//             Tailwind / Apple system stack.
//
//   Mono    — JetBrains Mono. Tabular numerics for tables, axes,
//             timestamps, percentages.
//
// All three load via next/font with font-display: swap + a system
// fallback in tailwind.config.ts.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});
const body = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Geck Inspect — Crested Gecko Market Intelligence",
  description: "Live pricing, trait economics, and seller analytics from MorphMarket.",
  icons: {
    icon: "/geck-logo.png",
    shortcut: "/geck-logo.png",
    apple: "/geck-logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="font-sans min-h-screen bg-ink-950 text-ink-100 antialiased">
        <TelemetryClient />
        <Header />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </body>
    </html>
  );
}
