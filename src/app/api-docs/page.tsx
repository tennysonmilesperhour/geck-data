// Public API documentation. The read-only endpoints under
// /api/market/* and /data/market.json are the supported public
// surface; everything else (alerts, training, upload, ingest) is
// either auth-gated or internal.
//
// Kept as a single static page rather than auto-generated from
// OpenAPI to keep the explanation prose readable. Each endpoint has
// an example URL the reader can click to inspect live.
import Link from "next/link";
import { SectionHeader, Panel } from "@/components/ui/Panel";

export const metadata = {
  title: "API - Geck Inspect Market",
  description:
    "Public read-only endpoints for crested gecko market data.",
};

export default function ApiDocsPage() {
  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Developer"
        title="Public API"
        description="Read-only HTTP endpoints under geck-data.vercel.app. All return JSON unless noted. Rate limit: courteous use; we may throttle at the edge if a single IP hammers an endpoint."
      />

      <Panel
        tone="soft"
        title="Contract guarantees"
        subtitle="What we promise about the endpoints below."
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-300">
          <li>
            Adding fields is non-breaking. Consumers should ignore unknown
            keys.
          </li>
          <li>
            Removing or renaming a field is a versioned change. We will add
            a <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">v2</code> path before deprecating v1.
          </li>
          <li>
            Cresteds only on every endpoint. Other species are filtered out
            at the source view (see migration 0010).
          </li>
          <li>
            CORS open to any origin for the GET endpoints. POST endpoints
            require Bearer auth and are not in scope here.
          </li>
        </ul>
      </Panel>

      <Endpoint
        method="GET"
        path="/data/market.json"
        purpose="The market snapshot that powers the Geck Inspect classifier app."
        params={[]}
        example="/data/market.json"
        notes="Heavy payload (megabytes). Cache at the consumer; the snapshot updates roughly hourly."
      />

      <Endpoint
        method="GET"
        path="/api/market/fair-price"
        purpose="Price estimate for a trait set. Either supply a canonical combo id or a comma-separated trait list. Returns p10/p25/p50/p75/p90 plus adjustment-factor multipliers for age, sex, weight, proven-breeder status."
        params={[
          { name: "combo", type: "string", note: "Canonical combo id (lw-cap, axa-pin, etc). Either this or `traits`." },
          { name: "traits", type: "string", note: "Comma-separated traits. Matched into a combo or used directly." },
          { name: "age", type: "enum", note: "hatchling, juvenile, subadult, adult, proven_breeder, unknown" },
          { name: "sex", type: "enum", note: "male, female, unknown" },
          { name: "weight", type: "number", note: "Grams" },
          { name: "proven", type: "bool", note: "true / false" },
          { name: "recent_sales", type: "int", note: "If > 0, include up to N recent comparable sales." },
        ]}
        example="/api/market/fair-price?combo=lw-cap&age=adult&sex=female&recent_sales=3"
        notes="Documented at /docs/geck-inspect-integration.md; the contract is shared with the classifier app."
      />

      <Endpoint
        method="GET"
        path="/api/market/temperature"
        purpose="Composite market temperature 0..100 plus weekly time series of listing volume, sold count, sell-through rate, median sold price, and median days to sell."
        params={[]}
        example="/api/market/temperature"
        notes="Backs the floating temperature card on /market."
      />

      <Endpoint
        method="GET"
        path="/api/market/arbitrage"
        purpose="Cross-platform arbitrage pair candidates. Joins MorphMarket and cross-platform listings by image pHash and emits the price delta."
        params={[]}
        example="/api/market/arbitrage"
        notes="Empty until the pHash worker has populated phash columns. Best-effort: pHash collisions exist; treat each row as a heads-up rather than a confirmation."
      />

      <Endpoint
        method="GET"
        path="/api/market/traits"
        purpose="Trait vocabulary observed in the database, with per-trait listing counts."
        params={[]}
        example="/api/market/traits"
        notes="Used by the trait picker on /whats-it-worth."
      />

      <Endpoint
        method="GET"
        path="/api/market/snapshot.csv"
        purpose="CSV export of the current market state - one row per canonical combo with the same fields the dashboard renders."
        params={[
          { name: "window_days", type: "int", note: "Defaults to 90." },
        ]}
        example="/api/market/snapshot.csv?window_days=90"
        notes="Returns Content-Type: text/csv. Suitable for sheets / Excel."
      />

      <Endpoint
        method="GET"
        path="/api/stats"
        purpose="Lightweight global counts for the homepage hero and the /status route."
        params={[]}
        example="/api/stats"
        notes="Returns total listings, sellers, sold, etc."
      />

      <Endpoint
        method="GET"
        path="/api/status.json"
        purpose="Per-stream ingest health snapshot. Reports lifetime + 7d counts and freshness per event stream."
        params={[]}
        example="/api/status.json"
        notes="Mirrors the /status page contents."
      />

      <Panel tone="soft" title="Not in scope here">
        <p className="text-sm text-ink-300">
          The following endpoints exist but require auth and are not
          considered public. Treat them as implementation details that may
          change without notice:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-400">
          <li>
            <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">/api/ingest</code> - extension event firehose, Bearer auth.
          </li>
          <li>
            <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">/api/upload</code> - dashboard drop-zone, session auth.
          </li>
          <li>
            <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">/api/alerts/*</code> - alert lifecycle, owner-scoped.
          </li>
          <li>
            <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">/api/training/*</code> - ML pipeline, admin only.
          </li>
          <li>
            <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">/api/trigger-scrape</code> - admin only.
          </li>
        </ul>
      </Panel>

      <p className="text-xs text-ink-500">
        Found a bug or want a new endpoint? Open an issue on{" "}
        <Link
          href="https://github.com/tennysonmilesperhour/geck-data"
          className="underline hover:text-ink-200"
        >
          github.com/tennysonmilesperhour/geck-data
        </Link>
        .
      </p>
    </div>
  );
}

function Endpoint({
  method,
  path,
  purpose,
  params,
  example,
  notes,
}: {
  method: "GET" | "POST";
  path: string;
  purpose: string;
  params: Array<{ name: string; type: string; note?: string }>;
  example?: string;
  notes?: string;
}) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2 font-mono">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
              method === "GET"
                ? "bg-ready/15 text-ready"
                : "bg-busy/15 text-busy"
            }`}
          >
            {method}
          </span>
          <span className="text-ink-100">{path}</span>
        </span>
      }
    >
      <p className="text-sm text-ink-300">{purpose}</p>
      {params.length > 0 ? (
        <table className="mt-3 w-full text-sm">
          <thead className="border-b border-ink-700/60 font-mono text-[10px] uppercase tracking-wider text-ink-400">
            <tr>
              <th className="py-1 pr-2 text-left">Param</th>
              <th className="py-1 pr-2 text-left">Type</th>
              <th className="py-1 text-left">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/40">
            {params.map((p) => (
              <tr key={p.name}>
                <td className="py-1 pr-2 font-mono text-ink-100">{p.name}</td>
                <td className="py-1 pr-2 font-mono text-ink-300">{p.type}</td>
                <td className="py-1 text-ink-400">{p.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {example ? (
        <div className="mt-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">Example</span>
          <pre className="mt-1 overflow-x-auto rounded bg-ink-950 p-2 font-mono text-xs text-ink-200">
            <a
              href={example}
              target="_blank"
              rel="noreferrer"
              className="hover:text-claude-glow"
            >
              {example}
            </a>
          </pre>
        </div>
      ) : null}
      {notes ? <p className="mt-2 text-xs text-ink-500">{notes}</p> : null}
    </Panel>
  );
}
