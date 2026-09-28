"use client";
// "Tell me when..." button. Saves an alert in the exact shape the alert
// matcher reads (src/lib/alerts/matcher.ts): trait_all, max_price,
// seller_ids. Visitors who are not logged in go to log in and come back.
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type SavedQuery = {
  trait_all?: string[];
  max_price?: number;
  seller_ids?: string[];
};

function SaveAlertInner({
  label,
  name,
  query,
}: {
  /** Button text, e.g. "Alert me under $350". */
  label: string;
  /** Plain description stored with the alert and shown on the watchlist. */
  name: string;
  query: SavedQuery;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setAuthed(Boolean(data.user));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const base =
    "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-60";

  if (status === "saved") {
    return (
      <span className={`${base} border-claude/50 bg-claude/15 text-claude-glow`}>
        <span aria-hidden="true">✓</span> Saved to your watchlist
      </span>
    );
  }

  async function save() {
    if (!authed) {
      const next = pathname + (params.toString() ? `?${params.toString()}` : "");
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    setStatus("saving");
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setStatus("error");
      return;
    }
    const { error } = await supabase.from("alerts").insert({
      owner_id: data.user.id,
      name,
      query: { species: "crested", ...query },
      active: true,
    });
    setStatus(error ? "error" : "saved");
  }

  return (
    <button
      type="button"
      onClick={save}
      disabled={status === "saving" || authed === null}
      className={`${base} border-ink-600 text-ink-100 hover:border-ink-500 hover:bg-ink-800`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0" />
      </svg>
      {status === "saving" ? "Saving" : label}
      {status === "error" ? <span className="text-danger">Try again</span> : null}
    </button>
  );
}

/** Suspense wrapper: the button reads the URL, which static pages render
 *  without at build time. */
export default function SaveAlert(props: Parameters<typeof SaveAlertInner>[0]) {
  return (
    <Suspense fallback={null}>
      <SaveAlertInner {...props} />
    </Suspense>
  );
}
