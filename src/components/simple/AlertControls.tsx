"use client";
// Pause, resume or remove one saved alert. Row-level security limits every
// change to the signed-in owner.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AlertControls({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: "toggle" | "remove") {
    if (action === "remove" && !window.confirm("Remove this alert?")) return;
    setBusy(true);
    const alerts = createClient().from("alerts");
    const { error } =
      action === "remove"
        ? await alerts.delete().eq("id", id)
        : await alerts.update({ active: !active }).eq("id", id);
    setBusy(false);
    if (!error) router.refresh();
  }

  const btn =
    "rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 transition hover:border-ink-500 hover:text-ink-50 disabled:opacity-50";
  return (
    <div className="flex gap-2">
      <button type="button" className={btn} disabled={busy} onClick={() => run("toggle")}>
        {active ? "Pause" : "Resume"}
      </button>
      <button type="button" className={btn} disabled={busy} onClick={() => run("remove")}>
        Remove
      </button>
    </div>
  );
}
