"use client";
// Inline button that creates a saved alert from any data row. Three
// surfaces use it today: /sellers/[id] (watch a seller),
// /sold table rows (watch a morph), /price-drops rows (watch a morph).
//
// Auth flow:
//   - Unauthenticated -> click opens /login?next=<current url>.
//   - Authenticated   -> insert via supabase RLS-scoped `alerts`
//     table, then briefly show "Watching" feedback.
//
// The persisted query payload is the same JSON shape /api/alerts
// already understands; nothing here changes the alert-matcher
// contract, it just gives users a one-click way to create rows.
import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type AlertQuery =
  | { kind: "seller"; seller_id: string }
  | { kind: "morph"; term: string }
  | { kind: "combo"; combo: string };

export default function WatchButton({
  label,
  alertName,
  query,
  size = "sm",
}: {
  label: string;
  alertName: string;
  query: AlertQuery;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "exists" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setAuthed(Boolean(data.user));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const px = size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-sm";

  // Loading state — auth still resolving. Render a neutral placeholder
  // sized the same as the eventual button so layout doesn't jump.
  if (authed === null) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-850/60 font-mono uppercase tracking-wider text-ink-500 ${px}`}
      >
        <span aria-hidden>☆</span>
        <span>Watch</span>
      </span>
    );
  }

  if (!authed) {
    const next = pathname + (params.toString() ? `?${params.toString()}` : "");
    return (
      <button
        type="button"
        onClick={() => router.push(`/login?next=${encodeURIComponent(next)}`)}
        title="Log in to save this alert"
        className={`inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-850 font-mono uppercase tracking-wider text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 ${px}`}
      >
        <span aria-hidden>☆</span>
        <span>{label}</span>
      </button>
    );
  }

  async function handleClick() {
    setStatus("saving");
    setErrorMsg(null);
    const supabase = createClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      setStatus("error");
      setErrorMsg("Session expired");
      return;
    }
    const { error } = await supabase.from("alerts").insert({
      owner_id: userData.user.id,
      name: alertName,
      query,
      active: true,
    });
    if (error) {
      // Duplicate-row attempts (when we later add a unique key on
      // query/owner) should not read as a generic failure. The
      // current schema has no uniqueness constraint, so this branch
      // is for future-proofing only — duplicates today silently
      // succeed and create a second row.
      setStatus("error");
      setErrorMsg(error.message);
      return;
    }
    setStatus("saved");
  }

  if (status === "saved") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border border-ready/40 bg-ready/10 font-mono uppercase tracking-wider text-ready ${px}`}
      >
        <span aria-hidden>★</span>
        <span>Watching</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status === "saving"}
      title={`Save "${alertName}" to your Alerts inbox`}
      className={`inline-flex items-center gap-1 rounded-md border border-claude/40 bg-claude/10 font-mono uppercase tracking-wider text-claude-glow transition hover:bg-claude/20 disabled:opacity-50 ${px}`}
    >
      <span aria-hidden>{status === "saving" ? "…" : "☆"}</span>
      <span>{status === "saving" ? "Saving" : label}</span>
      {status === "error" && errorMsg ? (
        <span className="ml-1 text-danger" title={errorMsg}>
          !
        </span>
      ) : null}
    </button>
  );
}
