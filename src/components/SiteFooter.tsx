import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/methodology", label: "How prices work" },
  { href: "/status", label: "Data status" },
  { href: "/api-docs", label: "API" },
] as const;

export default function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-ink-800">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="max-w-xl text-ink-500">
          Prices come from public MorphMarket listings. Sold prices are the last asking
          price before a listing came down. Part of{" "}
          <a href="https://geckinspect.com" className="text-ink-300 hover:text-ink-50">
            Geck Inspect
          </a>
          .
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-ink-400" aria-label="Footer">
          {FOOTER_LINKS.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-ink-50">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
