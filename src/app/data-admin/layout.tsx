// Auth gate for every /data-admin/* route.
//
// Unlike the existing /admin/* (geck-inspect) gate which checks
// profiles.role = 'admin', this gate uses an explicit ADMIN_USER_ID
// allowlist of one. That keeps the geck-data admin self-contained and
// independent of the geck-inspect profiles table.
//
// Sign in flow:
//   1) Tennyson signs up at /login (Supabase Auth, email + password)
//   2) He grabs his user id from Supabase Dashboard > Authentication > Users
//   3) He pastes it into ADMIN_USER_ID in Vercel env vars
//
// If ADMIN_USER_ID is unset we treat every signed-in user as forbidden
// rather than allow accidental access.

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NAV_ITEMS = [
  { href: "/data-admin", label: "Overview" },
  { href: "/data-admin/listings", label: "Listings" },
  { href: "/data-admin/morphs", label: "Morphs" },
  { href: "/data-admin/sellers", label: "Sellers" },
  { href: "/data-admin/runs", label: "Scrape runs" },
  { href: "/data-admin/training", label: "Morph ID training" },
];

export default async function DataAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) redirect("/login?next=/data-admin");

  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || user.id !== adminId) {
    return (
      <div className="mx-auto my-16 max-w-xl rounded-lg border border-ink-700 bg-ink-800 p-6 text-sm shadow-panel">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
          Admin only
        </div>
        <h1 className="mt-2 text-xl font-semibold text-ink-50">
          Not authorised.
        </h1>
        <p className="mt-2 text-ink-300">
          /data-admin is gated to a single Supabase Auth user. If you should
          have access, ask whoever runs this project to set ADMIN_USER_ID in
          Vercel env vars to your user id.
        </p>
        <p className="mt-2 font-mono text-xs text-ink-400">
          your id: {user.id}
        </p>
        <div className="mt-4">
          <Link
            href="/"
            className="rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-ink-200 hover:border-ink-600 hover:text-ink-50"
          >
            Back home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-ink-700 pb-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
              Geck Data
            </div>
            <h1 className="text-xl font-semibold text-ink-50">Admin</h1>
          </div>
        </div>
        <nav className="mt-3 flex flex-wrap gap-2 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-ink-200 hover:border-ink-600 hover:text-ink-50"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
