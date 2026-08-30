import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/methodology", label: "Methodology" },
  { href: "/status", label: "Data status" },
  { href: "/api-docs", label: "API" },
  { href: "/settings", label: "Settings" },
] as const;

export default function SiteFooter() {
  return (
    <footer className="border-t border-ink-700/80 bg-ink-950/80">
      <div className="mx-auto grid min-h-[96px] w-full max-w-[1600px] grid-cols-1 items-center gap-5 px-4 py-5 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] lg:px-8">
        <div>
          <p className="m-0 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-clay-300">
            Geck Inspect / Market intelligence
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-ink-500">
            Asking prices, observed listings, and completed-sale records are kept as separate evidence layers. Every analytical page states its source window and known coverage limits.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-400" aria-label="Supporting information">
          {FOOTER_LINKS.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-claude-glow">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
