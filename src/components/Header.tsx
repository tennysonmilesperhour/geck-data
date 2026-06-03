"use client";
// Claude Code-styled top navigation with a leading asterisk wordmark,
// grouped section tabs, and a compact auth/session cluster. The full tab
// row shows inline on large screens; below `lg` it collapses into a
// hamburger that opens a slide-in drawer so the header stays one line on
// phones instead of wrapping into five stacked rows.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SettingsDrawer from "@/components/settings/SettingsDrawer";
import Logo from "@/components/ui/Logo";

type Group = "core" | "analysis" | "ops";
type Tab = { href: string; label: string; group?: Group };

const TABS: Tab[] = [
  { href: "/",                label: "Pulse",         group: "core" },
  { href: "/whats-it-worth",  label: "What's it worth?", group: "core" },
  { href: "/sold",            label: "Sold",          group: "core" },
  { href: "/price-drops",     label: "Drops",         group: "core" },
  { href: "/sellers",         label: "Sellers",       group: "core" },
  { href: "/market",          label: "Market",        group: "analysis" },
  { href: "/indices",         label: "Indices",       group: "analysis" },
  { href: "/trends",          label: "Trends",        group: "analysis" },
  { href: "/compare",         label: "Compare",       group: "analysis" },
  { href: "/reports",         label: "Reports",       group: "analysis" },
  { href: "/shows",           label: "Shows",         group: "ops" },
  { href: "/cross-platform",  label: "Cross-platform", group: "ops" },
];

const GROUP_LABELS: Record<Group, string> = {
  core: "Core",
  analysis: "Analysis",
  ops: "Operations",
};

export default function Header() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  // Close the mobile drawer whenever the route changes, and lock body
  // scroll / wire up Escape while it's open (mirrors SettingsDrawer).
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

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

  // Extra links that depend on session/role, surfaced both inline (lg+)
  // and inside the mobile drawer.
  const sessionTabs: Tab[] = [];
  if (loaded && user) {
    sessionTabs.push({ href: "/watchlist", label: "Watchlist" });
    sessionTabs.push({ href: "/alerts", label: "Alerts" });
  }
  if (loaded && role === "admin") {
    sessionTabs.push({ href: "/admin/analytics", label: "Analytics" });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-ink-700/70 bg-ink-900/80 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-ink-50">
          <Logo size={28} />
          <span className="font-display text-[15px] font-medium tracking-tight">
            Geck Inspect
          </span>
          <span className="ml-1 hidden rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-ink-400 sm:inline">
            market
          </span>
        </Link>

        {/* Inline tab bar — large screens only. */}
        <div className="hidden flex-1 flex-wrap items-center gap-0.5 text-[13px] lg:flex">
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
          {sessionTabs.length > 0 ? (
            <>
              <span aria-hidden className="mx-1.5 h-4 w-px bg-ink-700" />
              {sessionTabs.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`rounded-md px-2.5 py-1.5 ${
                    isActive(t.href)
                      ? "bg-ink-800 text-ink-50 shadow-panel"
                      : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </>
          ) : null}
        </div>

        {/* Spacer so the right cluster stays pinned right below lg. */}
        <div className="flex-1 lg:hidden" />

        <div className="flex items-center gap-2 text-[13px] sm:gap-3">
          <span className="hidden items-center gap-1.5 text-ink-400 md:inline-flex">
            <span className="status-dot" />
            <span className="font-mono text-[11px] uppercase tracking-wider">Ready</span>
          </span>
          <SettingsDrawer />
          {loaded && user ? (
            <>
              <Link
                href="/upload"
                className="hidden rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-ink-200 hover:border-ink-600 hover:text-ink-50 sm:inline-block"
              >
                Upload
              </Link>
              <span className="hidden text-ink-400 md:inline">{user.email}</span>
              <button
                onClick={logout}
                className="hidden text-ink-400 hover:text-ink-100 sm:inline"
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

          {/* Hamburger — small screens only. */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            className="rounded-md border border-ink-700 bg-ink-850 p-1.5 text-ink-300 hover:border-ink-600 hover:text-ink-50 lg:hidden"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile navigation drawer. */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label="Navigation"
            className="absolute right-0 top-0 flex h-full w-full max-w-xs flex-col border-l border-ink-700 bg-ink-900 shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
              <span className="flex items-center gap-2 text-ink-50">
                <Logo size={24} />
                <span className="font-display text-sm font-medium tracking-tight">
                  Geck Inspect
                </span>
              </span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="text-ink-400 hover:text-ink-100"
                aria-label="Close navigation menu"
              >
                ✕
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-3 py-4">
              {(["core", "analysis", "ops"] as Group[]).map((group) => (
                <div key={group} className="mb-5">
                  <p className="px-2 pb-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-500">
                    {GROUP_LABELS[group]}
                  </p>
                  <div className="flex flex-col">
                    {TABS.filter((t) => t.group === group).map((t) => (
                      <Link
                        key={t.href}
                        href={t.href}
                        onClick={() => setMenuOpen(false)}
                        className={`rounded-md px-2.5 py-2.5 text-sm ${
                          isActive(t.href)
                            ? "bg-ink-800 text-ink-50"
                            : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                        }`}
                      >
                        {t.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}

              {sessionTabs.length > 0 ? (
                <div className="mb-5">
                  <p className="px-2 pb-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-500">
                    You
                  </p>
                  <div className="flex flex-col">
                    {sessionTabs.map((t) => (
                      <Link
                        key={t.href}
                        href={t.href}
                        onClick={() => setMenuOpen(false)}
                        className={`rounded-md px-2.5 py-2.5 text-sm ${
                          isActive(t.href)
                            ? "bg-ink-800 text-ink-50"
                            : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                        }`}
                      >
                        {t.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <footer className="border-t border-ink-700 px-3 py-3">
              {loaded && user ? (
                <div className="flex flex-col gap-2">
                  {user.email ? (
                    <span className="truncate px-2 text-xs text-ink-400">{user.email}</span>
                  ) : null}
                  <Link
                    href="/upload"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-2 text-center text-sm text-ink-200 hover:border-ink-600 hover:text-ink-50"
                  >
                    Upload
                  </Link>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                    type="button"
                    className="rounded-md px-2.5 py-2 text-center text-sm text-ink-400 hover:bg-ink-850 hover:text-ink-100"
                  >
                    Log out
                  </button>
                </div>
              ) : loaded ? (
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-md bg-claude px-3 py-2 text-center text-sm text-ink-50 shadow-glow hover:bg-claude-glow"
                >
                  Log in
                </Link>
              ) : null}
            </footer>
          </aside>
        </div>
      ) : null}
    </header>
  );
}
