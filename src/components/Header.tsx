"use client";
// Claude Code-styled top navigation with a leading asterisk wordmark,
// grouped section tabs, and a compact auth/session cluster.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Tab = { href: string; label: string; group?: "core" | "analysis" | "ops" };

const TABS: Tab[] = [
  { href: "/",               label: "Pulse",         group: "core" },
  { href: "/daily-log",      label: "Daily Log",     group: "core" },
  { href: "/sold",           label: "Sold",          group: "core" },
  { href: "/price-drops",    label: "Drops",         group: "core" },
  { href: "/sellers",        label: "Sellers",       group: "core" },
  { href: "/trends",         label: "Trends",        group: "analysis" },
  { href: "/compare",        label: "Compare",       group: "analysis" },
  { href: "/shows",          label: "Shows",         group: "ops" },
  { href: "/cross-platform", label: "Cross-platform", group: "ops" },
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
    <header className="sticky top-0 z-30 border-b border-ink-700/70 bg-ink-900/80 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-6 px-6 py-3">
        <Link href="/" className="flex items-center gap-2 text-ink-50">
          <span className="claude-star text-xl leading-none">✷</span>
          <span className="text-sm font-semibold tracking-tight">Geck Inspect</span>
          <span className="ml-1 rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-ink-400">
            market
          </span>
        </Link>

        <div className="flex flex-1 flex-wrap items-center gap-0.5 text-[13px]">
          {TABS.map((t, i) => {
            const prev = TABS[i - 1];
            const divider = prev && prev.group !== t.group ? (
              <span key={`d-${t.href}`} aria-hidden className="mx-1.5 h-4 w-px bg-ink-700" />
            ) : null;
            return (
              <span key={t.href} className="flex items-center">
                {divider}
                <Link
                  href={t.href}
                  className={`rounded-md px-2.5 py-1.5 transition ${
                    isActive(t.href)
                      ? "bg-ink-800 text-ink-50 shadow-panel"
                      : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                  }`}
                >
                  {t.label}
                </Link>
              </span>
            );
          })}
          {loaded && user ? (
            <Link
              href="/alerts"
              className={`ml-1 rounded-md px-2.5 py-1.5 ${
                isActive("/alerts")
                  ? "bg-ink-800 text-ink-50 shadow-panel"
                  : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
              }`}
            >
              Alerts
            </Link>
          ) : null}
        </div>

        <div className="flex items-center gap-3 text-[13px]">
          <span className="hidden items-center gap-1.5 text-ink-400 md:inline-flex">
            <span className="status-dot" />
            <span className="font-mono text-[11px] uppercase tracking-wider">Ready</span>
          </span>
          {loaded && user ? (
            <>
              <Link
                href="/upload"
                className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-ink-200 hover:border-ink-600 hover:text-ink-50"
              >
                Upload
              </Link>
              <span className="hidden text-ink-400 md:inline">{user.email}</span>
              <button
                onClick={logout}
                className="text-ink-400 hover:text-ink-100"
                type="button"
              >
                Log out
              </button>
            </>
          ) : loaded ? (
            <Link
              href="/login"
              className="rounded-md bg-claude px-3 py-1.5 text-ink-50 shadow-glow hover:bg-claude-glow"
            >
              Log in
            </Link>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
