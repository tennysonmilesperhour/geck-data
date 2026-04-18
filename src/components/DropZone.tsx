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
            ? "border-gecko bg-gecko-light/30"
            : "border-neutral-300 bg-neutral-50 hover:border-gecko hover:bg-gecko-light/10"
        }`}
      >
        <input {...getInputProps()} />
        <p className="text-lg font-medium">
          {isDragActive ? "Drop files here" : "Drag files here, or click to browse"}
        </p>
        <p className="mt-2 text-sm text-neutral-600">
          Accepts: <code>.db</code> (SQLite), images (JPG/PNG/WebP),{" "}
          <code>.csv</code>. Multi-file OK.
        </p>
      </div>

      {busy && (
        <p className="mt-4 text-sm text-neutral-600">
          Processing… (sql.js parses are server-side; can take 10–30s for a fresh .db)
        </p>
      )}

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      {results && (
        <div className="mt-4 space-y-2">
          <h3 className="font-semibold">Results</h3>
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white">
            {results.map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
                <div>
                  <span
                    className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs ${
                      r.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {r.ok ? "ok" : "failed"}
                  </span>
                  <span className="font-mono">{r.file}</span>{" "}
                  <span className="text-neutral-500">[{r.kind}]</span>
                </div>
                <div className="max-w-md text-right text-neutral-600">{r.detail}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
