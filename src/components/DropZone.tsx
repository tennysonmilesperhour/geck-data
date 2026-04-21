"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

type ApiResult = {
  results: { file: string; kind: string; ok: boolean; detail: string }[];
};

export default function DropZone() {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ApiResult["results"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (accepted: File[]) => {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const fd = new FormData();
      for (const f of accepted) fd.append("files", f, f.name);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = (await res.json()) as ApiResult & { error?: string };
      if (!res.ok) {
        setError(json.error || `Upload failed (${res.status})`);
        return;
      }
      setResults(json.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  });

  return (
    <div>
      <div
        {...getRootProps()}
        className={`flex h-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition ${
          isDragActive
            ? "border-claude bg-claude/10"
            : "border-ink-700 bg-ink-850 hover:border-claude hover:bg-claude/5"
        }`}
      >
        <input {...getInputProps()} />
        <p className="text-lg font-medium text-ink-100">
          {isDragActive ? "Drop files here" : "Drag files here, or click to browse"}
        </p>
        <p className="mt-2 text-sm text-ink-400">
          Accepts: <code>.db</code> (SQLite), images (JPG/PNG/WebP),{" "}
          <code>.csv</code>. Multi-file OK.
        </p>
      </div>

      {busy && (
        <p className="mt-4 text-sm text-ink-400">
          Processing… (sql.js parses are server-side; can take 10–30s for a fresh .db)
        </p>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
      )}

      {results && (
        <div className="mt-4 space-y-2">
          <h3 className="font-semibold text-ink-50">Results</h3>
          <ul className="divide-y divide-ink-700 rounded-md border border-ink-700 bg-ink-800">
            {results.map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
                <div>
                  <span
                    className={`mr-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                      r.ok
                        ? "border-ready/40 bg-ready/10 text-ready"
                        : "border-danger/40 bg-danger/10 text-danger"
                    }`}
                  >
                    {r.ok ? "ok" : "failed"}
                  </span>
                  <span className="font-mono text-ink-100">{r.file}</span>{" "}
                  <span className="text-ink-400">[{r.kind}]</span>
                </div>
                <div className="max-w-md text-right text-ink-400">{r.detail}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
