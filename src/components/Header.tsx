"use client";
// Site header. Four destinations and nothing else:
//   Price check (home), Morphs, Listings, Breeders.
// Account links sit on the right. On phones the four links drop to a
// second row instead of hiding behind a menu, so nothing is ever more
// than one tap away.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/ui/Logo";

const NAV = [
  { href: "/", label: "Price check" },
  { href: "/morphs", label: "Morphs" },
  { href: "/listings", label: "Listings" },
  { href: "/sellers", label: "Breeders" },
] as const;

export default function Header() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setLoaded(true);
      if (data.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .maybeSingle();
        if (active) setRole((profile?.role as string) ?? null);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) setRole(null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function logout() {
    await supabase.auth.signOut();
    router.refresh();
    router.push("/");
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  const navLinks = NAV.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isActive(item.href) ? "page" : undefined}
      className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
        isActive(item.href)
          ? "bg-ink-800 text-ink-50"
          : "text-ink-300 hover:bg-ink-850 hover:text-ink-50"
      }`}
    >
      {item.label}
    </Link>
  ));

  return (
    <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-950/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-ink-50">
          <Logo size={28} />
          <span className="text-base font-semibold tracking-tight">
            Geck Inspect <span className="font-normal text-ink-400">Market</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {navLinks}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-sm">
          {loaded && user ? (
            <>
              <Link href="/watchlist" className="hidden text-ink-300 hover:text-ink-50 sm:inline">
                Watchlist
              </Link>
              {role === "admin" ? (
                <Link href="/data-admin" className="hidden text-ink-300 hover:text-ink-50 sm:inline">
                  Admin
                </Link>
              ) : null}
              <button type="button" onClick={logout} className="text-ink-400 hover:text-ink-50">
                Log out
              </button>
            </>
          ) : loaded ? (
            <Link href="/login" className="text-ink-300 hover:text-ink-50">
              Log in
            </Link>
          ) : null}
        </div>
      </div>

      <nav
        className="flex gap-1 overflow-x-auto border-t border-ink-800 px-3 py-2 md:hidden"
        aria-label="Main"
      >
        {navLinks}
      </nav>
    </header>
  );
}
