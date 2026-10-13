// Server-side gate for members-only pages (single listings, their photos and
// their sellers). The middleware already redirects signed-out visitors; this
// is the second lock in case it ever passes a request through.
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";

export default async function MembersGate({ path, children }: { path: string; children: ReactNode }) {
  let signedIn = false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  } catch {
    signedIn = false;
  }
  if (!signedIn) redirect(`/login?next=${encodeURIComponent(path)}`);
  return <>{children}</>;
}
