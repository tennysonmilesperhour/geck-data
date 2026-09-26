import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import StaleDataBanner from "@/components/StaleDataBanner";
import ErrorBoundary from "@/components/ErrorBoundary";
import TelemetryClient from "@/components/TelemetryClient";
import VersionToast from "@/components/VersionToast";
import { MorphTermProvider } from "@/components/morphs/MorphTerm";
import SiteFooter from "@/components/SiteFooter";

// Typography. The pairing follows the UI Pro Max "Dashboard Data"
// recommendation for analytics-first products, swapped to keep our
// editorial display face on top:
//
//   Body: IBM Plex Sans (300/400/500/600/700)
//             Replaces Inter. Plex is purpose-built for data UI:
//             slightly humanist, tabular figures, identifiable in
//             screenshots, and unmistakably *not* a default
//             Tailwind / Apple system stack.
//
//   Mono: JetBrains Mono. Tabular numerics for tables, axes,
//             timestamps, percentages.
//
// Both load via next/font with font-display: swap + a system
// fallback in tailwind.config.ts.
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
  title: "Geck Inspect Market: what is your crested gecko worth?",
  description: "Crested gecko prices by morph, from real MorphMarket listings and sales.",
  icons: {
    icon: "/geck-logo.png",
    shortcut: "/geck-logo.png",
    apple: "/geck-logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${body.variable} ${mono.variable}`}>
      <body className="geck-app min-h-screen bg-ink-950 font-sans text-ink-100 antialiased">
        <TelemetryClient />
        <VersionToast />
        <Header />
        <StaleDataBanner />
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          <MorphTermProvider>
            <ErrorBoundary>{children}</ErrorBoundary>
          </MorphTermProvider>
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
