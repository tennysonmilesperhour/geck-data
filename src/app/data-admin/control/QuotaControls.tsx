"use client";

import { useState } from "react";
import type { RuntimeConfigRow } from "@/lib/geck-data/queries";

type SaveState = "idle" | "saving" | "ok" | "error";

export function QuotaControls({ rows }: { rows: RuntimeConfigRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-ink-700 bg-ink-850 p-4 text-sm text-ink-400">
        runtime_config is empty. Run migration 0022 to seed it.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <QuotaRow key={row.key} row={row} />
      ))}
    </div>
  );
}

function QuotaRow({ row }: { row: RuntimeConfigRow }) {
  const initial =
    row.value === null || row.value === undefined ? "" : String(row.value);
  const [draft, setDraft] = useState<string>(initial);
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string>("");

  const dirty = draft !== initial;

  async function save() {
    setState("saving");
    setMessage("");
    try {
      const parsed = parseDraft(draft, row.value_kind);
      const res = await fetch("/api/runtime-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: row.key, value: parsed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMessage(body?.error ?? `Failed (HTTP ${res.status})`);
        return;
      }
      setState("ok");
      setMessage("Saved. Next call picks it up.");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="rounded-md border border-ink-700 bg-ink-850 p-4">
      <div className="flex items-center justify-between gap-2">
        <code className="text-xs font-mono text-ink-200">{row.key}</code>
        <span className="rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
          {row.value_kind}
        </span>
      </div>
      {row.description && (
        <div className="mt-1 text-xs text-ink-400">{row.description}</div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <input
          type={row.value_kind === "integer" || row.value_kind === "number" ? "number" : "text"}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setState("idle");
            setMessage("");
          }}
          className="w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-sm text-ink-50 focus:border-ink-500 focus:outline-none"
          inputMode={row.value_kind === "integer" ? "numeric" : undefined}
        />
        <button
          type="button"
          onClick={save}
          disabled={!dirty || state === "saving"}
          className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1 text-sm text-ink-50 hover:border-ink-500 disabled:opacity-40"
        >
          {state === "saving" ? "..." : "Save"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-400">
        {(row.min_value !== null || row.max_value !== null) && (
          <span>
            range {row.min_value ?? "-inf"} to {row.max_value ?? "+inf"}
          </span>
        )}
        <span>
          last changed {row.updated_at ? new Date(row.updated_at).toLocaleString() : "-"}
          {row.updated_by ? ` by ${row.updated_by}` : ""}
        </span>
        {state === "ok" && <span className="text-emerald-300">{message}</span>}
        {state === "error" && <span className="text-red-300">{message}</span>}
      </div>
    </div>
  );
}

function parseDraft(draft: string, kind: string): unknown {
  switch (kind) {
    case "integer":
      return Math.trunc(Number(draft));
    case "number":
      return Number(draft);
    case "boolean":
      return draft === "true";
    case "json":
      return JSON.parse(draft);
    default:
      return draft;
  }
}
