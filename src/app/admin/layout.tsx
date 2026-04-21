// Admin gate — wraps every /admin/* route. Three-stage check:
//   1) Middleware has already bounced anon users to /login.
//   2) Here we re-read the session server-side (belt-and-suspenders) and
//      look up public.profiles.role.
//   3) Non-admins get a friendly 403 panel instead of the page.
//
// Relies on the migration in 0003_admin_analytics.sql: profiles table +
// is_admin() RLS policies. If the migration hasn't run, profiles.role will
// 404 gracefully (we treat any lookup failure as "not admin").
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) redirect("/login?next=/admin/analytics");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return (
      <div className="mx-auto my-16 max-w-xl rounded-lg border border-ink-700 bg-ink-800 p-6 text-sm shadow-panel">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
          Admin only
        </div>
        <h1 className="mt-2 text-xl font-semibold text-ink-50">
          You&apos;re signed in, but not an admin.
        </h1>
        <p className="mt-2 text-ink-300">
          Admin pages surface cross-user telemetry and error logs. If you should
          have access, ask a current admin to run this in the Supabase SQL
          editor:
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-ink-900/60 p-3 font-mono text-xs text-ink-200">
{`update public.profiles
set role = 'admin'
where email = '${user.email ?? "you@example.com"}';`}
        </pre>
        <div className="mt-4">
          <Link
            href="/"
            className="rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-ink-200 hover:border-ink-600 hover:text-ink-50"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <div className="space-y-6">{children}</div>;
}
