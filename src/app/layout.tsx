import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import ErrorBoundary from "@/components/ErrorBoundary";
import TelemetryClient from "@/components/TelemetryClient";

// Typography pair. Fraunces is the editorial display face — variable,
// optical-size aware, and carries enough personality to anchor headers
// without competing with charts. Inter handles body / data table copy.
// JetBrains Mono is the numeric / status face. All three load via
// next/font for proper font-display swap + zero CLS.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  // Variable font — `weight` is not specified so next/font loads the
  // full variable file. `axes` opts into Fraunces's optical-size +
  // SOFT/WONK axes for a hint of character on big titles without
  // making everything feel decorative.
  axes: ["SOFT", "WONK", "opsz"],
});
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
