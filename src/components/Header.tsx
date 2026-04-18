"use client";
// Client component so the auth state stays in sync as the user navigates
// (server-component layouts can render stale auth state on client-side
// navigations). Subscribes to onAuthStateChange so login/logout updates
// the nav instantly.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Header() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();

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

  return (
    <header className="border-b border-neutral-200 bg-white">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold text-gecko-dark">
          Geck Inspect
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:text-gecko">
            Dashboard
          </Link>
          {loaded && user ? (
            <>
              <Link href="/upload" className="hover:text-gecko">
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
