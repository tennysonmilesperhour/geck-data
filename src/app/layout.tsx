import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import {
  getMarketFeedVerdict,
  getOptionalSections,
} from "@/lib/market/freshness";
import StaleDataBanner from "@/components/StaleDataBanner";
import ErrorBoundary from "@/components/ErrorBoundary";
import TelemetryClient from "@/components/TelemetryClient";
import VersionToast from "@/components/VersionToast";
import { MorphTermProvider } from "@/components/morphs/MorphTerm";

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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Allow pinch-zoom (accessibility) while keeping the default fit-to-width.
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "Geck Inspect — Crested Gecko Market Intelligence",
  description: "Live pricing, trait economics, and seller analytics from MorphMarket.",
  icons: {
    icon: "/geck-logo.png",
    shortcut: "/geck-logo.png",
    apple: "/geck-logo.png",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The header pip used to be a hardcoded "Ready" while /status could be
  // reporting the pipeline as down on the same page load. Resolving the
  // verdict here, in the one server component every page passes through,
  // means the pip, the stale banner and /status cannot disagree. Failing
  // closed to null keeps a Supabase hiccup from taking down every page.
  //
  // The section gate beside it decides whether Shows, Cross-platform, and
  // Drops render at all. The first two point at empty tables; price_drops
  // still has historical rows but the stream has been dead since June, so
  // that tab is gated on recent row count. Fail to null shows every tab,
  // because hiding a section that does have data is the worse error.
  const [feed, sections] = await Promise.all([
    getMarketFeedVerdict().catch(() => null),
    getOptionalSections().catch(() => null),
  ]);

  return (
    <html
      lang="en"
      className={`dark ${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="font-sans min-h-screen bg-ink-950 text-ink-100 antialiased">
        <TelemetryClient />
        <VersionToast />
        <StaleDataBanner />
        <Header feed={feed} sections={sections} />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <MorphTermProvider>
            <ErrorBoundary>{children}</ErrorBoundary>
          </MorphTermProvider>
        </main>
      </body>
    </html>
  );
}
