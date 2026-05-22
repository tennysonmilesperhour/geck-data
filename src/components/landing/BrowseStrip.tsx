// Three-up "go deeper" navigation strip for Pulse. The new routes
// (Indices, Methodology, Watchlist) aren't surfaced obviously from
// the hero, so this strip puts them on the path of every visitor.
//
// Pure presentational. Server-component-safe. Lives directly under
// the hero on /.
import Link from "next/link";

type Card = {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  accent: string;
  glyph: string;
};

const CARDS: Card[] = [
  {
    href: "/indices",
    eyebrow: "Track",
    title: "Composite indices",
    body: "One number per anchor family and per canonical combo. 7d / 30d / 90d deltas with sparklines.",
    accent: "#0e9a73",
    glyph: "◈",
  },
  {
    href: "/methodology",
    eyebrow: "Trust",
    title: "Methodology",
    body: "How every metric is computed and what its blind spots are. The trust layer behind the dashboard.",
    accent: "#7ab1d1",
    glyph: "❉",
  },
  {
    href: "/watchlist",
    eyebrow: "Save",
    title: "Watchlist",
    body: "Save combos, traits, sellers, regions. Matches land in /alerts. Sign in to start tracking.",
    accent: "#cd6e3c",
    glyph: "★",
  },
];

export default function BrowseStrip() {
  return (
    <section>
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
        Browse
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group relative overflow-hidden rounded-xl border border-ink-700 bg-ink-850 p-4 transition hover:border-ink-600"
            style={{
              backgroundImage: `linear-gradient(135deg, ${c.accent}1f 0%, transparent 80%)`,
            }}
          >
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 w-1"
              style={{ background: c.accent, opacity: 0.9 }}
            />
            <div className="relative flex items-start gap-3">
              <span
                aria-hidden
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg font-display text-lg"
                style={{
                  color: c.accent,
                  background: `${c.accent}22`,
                  boxShadow: `inset 0 0 0 1px ${c.accent}55`,
                }}
              >
                {c.glyph}
              </span>
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
                  {c.eyebrow}
                </div>
                <div className="mt-0.5 font-display text-[16px] font-medium tracking-tight text-ink-50 group-hover:text-claude-glow">
                  {c.title} →
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-400">{c.body}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
