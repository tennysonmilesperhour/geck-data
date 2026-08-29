// Embeddable market temperature widget.
//
//   <iframe
//     src="https://geck-data.vercel.app/embed/market-temperature"
//     width="360" height="200" frameborder="0">
//   </iframe>
//
// Strips header/nav/footer so the iframe content is just the score card.
// CORS is irrelevant for iframes; we set X-Frame-Options-friendly headers
// in middleware-light fashion by avoiding any anti-embed metadata.
//
// Uses the same data path as the dashboard card, including its unavailable
// state: when /api/market/temperature fails its coverage gates the card prints
// "Unavailable" and the reason instead of a score, which takes a few lines of
// copy. Size the iframe for that, not for the one-line score, or an embedder
// will clip the only part of the widget that explains itself.

import MarketTemperatureCard from "@/components/market/MarketTemperatureCard";

export const dynamic = "force-dynamic";

export const metadata = {
  // Avoid title pollution in the iframe parent's history.
  title: "Geck Inspect Market Temperature",
  // Embed views don't need to be indexed.
  robots: { index: false, follow: false },
};

export default function MarketTemperatureEmbed() {
  return (
    <div className="min-h-screen bg-forest-950 p-2">
      {/* Strip the global Header + main padding so the iframe content fits
          a small viewport. App-router root layout can't be skipped from a
          child route, so we hide its chrome with scoped CSS instead. */}
      <style>{`
        header.sticky { display: none !important; }
        main { padding: 0 !important; max-width: none !important; }
      `}</style>
      <MarketTemperatureCard />
      <div className="mt-2 text-center text-[10px] leading-relaxed text-forest-500">
        <div>A score publishes only while the sold stream is current.</div>
        <a
          href="https://geck-data.vercel.app/market"
          target="_blank"
          rel="noreferrer"
          className="hover:text-forest-300"
        >
          geck-data · live crested market
        </a>
      </div>
    </div>
  );
}
