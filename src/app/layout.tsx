import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import StaleDataBanner from "@/components/StaleDataBanner";
import ErrorBoundary from "@/components/ErrorBoundary";
import TelemetryClient from "@/components/TelemetryClient";
import VersionToast from "@/components/VersionToast";
import { MorphTermProvider } from "@/components/morphs/MorphTerm";
import SiteFooter from "@/components/SiteFooter";

// Typography, matched to the Linear look:
//
//   Body: Inter (variable). Linear's own typeface is built on Inter, and
//             it carries tabular figures for prices and counts.
//
//   Mono: JetBrains Mono. Tabular numerics for tables, axes,
//             timestamps, percentages.
//
// Both load via next/font with font-display: swap + a system
// fallback in tailwind.config.ts.
const body = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Applies the saved light/dark choice before first paint so the page never
// flashes the wrong theme. Dark is the default. Keep the key in sync with
// THEME_KEY in components/ThemeToggle.tsx.
const themeScript = `(function(){try{var t=localStorage.getItem("geck-theme");if(t!=="light")t="dark";var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;}catch(e){}})();`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Allow pinch-zoom (accessibility) while keeping the default fit-to-width.
  maximumScale: 5,
};

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://geck-data.vercel.app"
).replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Geck Inspect Market: what is your crested gecko worth?",
    template: "%s",
  },
  description: "Crested gecko prices by morph, from real MorphMarket listings and sales.",
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    siteName: "Geck Inspect Market",
    url: "./",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "Geck Inspect Market: what is your crested gecko worth?",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.jpg"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`dark ${body.variable} ${mono.variable}`}
    >
      <head>
        <link rel="preload" as="image" href="/geck-logo.webp" type="image/webp" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
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
