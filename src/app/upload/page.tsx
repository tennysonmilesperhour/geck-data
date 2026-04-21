// Protected by middleware — only logged-in users see this page.
import DropZone from "@/components/DropZone";
import { SectionHeader } from "@/components/ui/Panel";

export default function UploadPage() {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Ingest"
        title="Upload"
        description="Drop a fresh morphmarket_*.db to refresh the dashboard, or drop images and CSVs to add them to the system."
      />
      <DropZone />
      <details className="rounded-md border border-ink-700 bg-ink-850 p-3 text-sm text-ink-200">
        <summary className="cursor-pointer font-medium text-ink-100">What happens to each file type?</summary>
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
