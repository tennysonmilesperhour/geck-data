import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import ErrorBoundary from "@/components/ErrorBoundary";
import TelemetryClient from "@/components/TelemetryClient";

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
    <html lang="en" className="dark">
      <body className="font-sans min-h-screen bg-ink-950 text-ink-100">
        <TelemetryClient />
        <Header />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </body>
    </html>
  );
}
