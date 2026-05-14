// CTA row at the foot of the landing page — three clear next steps for a
// paying client who wants to go deeper than the snapshot. Each card has a
// distinct visual character so the eye picks the right one without reading.
import Link from "next/link";

const cards = [
  {
    href: "/market",
    title: "Market dashboard",
    sub: "Combos · regional · arbitrage · supply",
    accent: "from-emerald-500/[0.08] to-emerald-500/0 border-emerald-500/30",
  },
  {
    href: "/trends",
    title: "Trends",
    sub: "Price distribution · trait frequencies · time series",
    accent: "from-sky-500/[0.08] to-sky-500/0 border-sky-500/30",
  },
  {
    href: "/sellers",
    title: "Seller directory",
    sub: "Every seller, sortable by volume, price, specialty",
    accent: "from-violet-500/[0.08] to-violet-500/0 border-violet-500/30",
  },
];

export default function DeepDiveCta() {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
          Go deeper
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className={`group relative overflow-hidden rounded-xl border bg-ink-850 p-5 shadow-panel transition hover:bg-ink-800 ${c.accent}`}
          >
            <div
              aria-hidden
              className={`absolute inset-0 bg-gradient-to-br ${c.accent} opacity-60`}
            />
            <div className="relative">
              <div className="text-base font-semibold tracking-tight text-ink-50">
                {c.title}
              </div>
              <div className="mt-1 text-xs text-ink-400">{c.sub}</div>
              <div className="mt-4 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ink-300 transition group-hover:text-ink-50">
                Explore <span aria-hidden>→</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
