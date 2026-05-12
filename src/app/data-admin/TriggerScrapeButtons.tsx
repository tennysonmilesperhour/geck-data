"use client";

import { useState } from "react";

type Trigger = {
  workflow: string;
  label: string;
  description: string;
};

const TRIGGERS: Trigger[] = [
  {
    workflow: "scrape-listings-daily.yml",
    label: "Listings (daily)",
    description: "Walks the MorphMarket grid, ~15 min, ~265 Decodo credits.",
  },
  {
    workflow: "scrape-details-weekly.yml",
    label: "Details (weekly)",
    description:
      "Detail scrape for listings older than 7 days or never detailed.",
  },
  {
    workflow: "scrape-images-weekly.yml",
    label: "Images (weekly)",
    description:
      "Downloads any primary_image_url still on the MorphMarket CDN.",
  },
];

type State = "idle" | "loading" | "ok" | "error";

export function TriggerScrapeButtons() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {TRIGGERS.map((t) => (
        <TriggerCard key={t.workflow} trigger={t} />
      ))}
    </div>
  );
}

function TriggerCard({ trigger }: { trigger: Trigger }) {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string>("");

  async function run() {
    setState("loading");
    setMessage("");
    try {
      const res = await fetch("/api/trigger-scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: trigger.workflow }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMessage(body?.error ?? `Failed (HTTP ${res.status})`);
        return;
      }
      setState("ok");
      setMessage("Dispatched. Check GitHub Actions tab.");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="rounded-md border border-ink-700 bg-ink-850 p-4">
      <div className="font-semibold text-ink-100">{trigger.label}</div>
      <div className="mt-1 text-xs text-ink-400">{trigger.description}</div>
      <button
        type="button"
        onClick={run}
        disabled={state === "loading"}
        className="mt-3 w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-ink-50 hover:border-ink-500 disabled:opacity-50"
      >
        {state === "loading" ? "Dispatching..." : "Trigger run"}
      </button>
      {state === "ok" && (
        <div className="mt-2 text-xs text-emerald-300">{message}</div>
      )}
      {state === "error" && (
        <div className="mt-2 text-xs text-red-300">{message}</div>
      )}
    </div>
  );
}
