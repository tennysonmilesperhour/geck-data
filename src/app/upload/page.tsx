// Protected by middleware — only logged-in users see this page.
import DropZone from "@/components/DropZone";

export default function UploadPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-gecko-dark">Upload</h1>
        <p className="mt-1 text-neutral-600">
          Drop a fresh <code>morphmarket_*.db</code> to refresh the dashboard, or
          drop images and CSVs to add them to the system.
        </p>
      </header>
      <DropZone />
      <details className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
        <summary className="cursor-pointer font-medium">What happens to each file type?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <code>.db</code> / <code>.sqlite</code>: parsed server-side, then
            upserted to <code>market_listings</code> and <code>market_sellers</code> in
            batches of 50. Idempotent on primary keys.
          </li>
          <li>
            Images (jpg/png/webp): stored in the <code>listing-images</code> bucket. If
            the filename contains a MorphMarket id like <code>mm_3631595</code>, the
            image is automatically linked to that listing.
          </li>
          <li>
            <code>.csv</code> / <code>.tsv</code>: archived in the <code>raw-uploads</code>{" "}
            bucket. v1 doesn&apos;t parse them yet — they&apos;re saved for later.
          </li>
        </ul>
      </details>
    </div>
  );
}
