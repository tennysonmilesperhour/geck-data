"use client";
// Client component so the auth state stays in sync as the user navigates
// (server-component layouts can render stale auth state on client-side
// navigations). Subscribes to onAuthStateChange so login/logout updates
// the nav instantly.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PUBLIC_TABS = [
  { href: "/", label: "Pulse" },
  { href: "/sold", label: "Sold" },
  { href: "/price-drops", label: "Drops" },
  { href: "/sellers", label: "Sellers" },
  { href: "/shows", label: "Shows" },
  { href: "/cross-platform", label: "Cross-platform" },
];

export default function Header() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setLoaded(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/");
  }

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="border-b border-neutral-200 bg-white">
      <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="text-lg font-semibold text-gecko-dark">
          Geck Inspect
        </Link>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          {PUBLIC_TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`rounded-md px-2.5 py-1.5 ${
                isActive(t.href)
                  ? "bg-gecko/10 text-gecko-dark"
                  : "text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {t.label}
            </Link>
          ))}
          {loaded && user ? (
            <Link
              href="/alerts"
              className={`rounded-md px-2.5 py-1.5 ${
                isActive("/alerts")
                  ? "bg-gecko/10 text-gecko-dark"
                  : "text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              Alerts
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {loaded && user ? (
            <>
              <Link href="/upload" className="text-neutral-700 hover:text-gecko">
                Upload
              </Link>
              <span className="text-neutral-500">{user.email}</span>
              <button
                onClick={logout}
                className="text-neutral-600 hover:text-gecko"
                type="button"
              >
                Log out
              </button>
            </>
          ) : loaded ? (
            <Link
              href="/login"
              className="rounded-md bg-gecko px-3 py-1.5 text-white hover:bg-gecko-dark"
            >
              Log in
            </Link>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
