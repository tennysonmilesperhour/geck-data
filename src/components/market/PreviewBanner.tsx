// Amber "preview data" banner shown at the top of /market while real
// pipelines are still being wired. Click-through to the methodology doc
// once we have one; for now it's static copy mirroring the screenshots.
export default function PreviewBanner() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-busy/40 bg-busy/10 px-4 py-3 text-sm">
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-busy/60 text-xs text-busy"
      >
        !
      </span>
      <p className="leading-5 text-ink-200">
        <span className="font-semibold text-busy">Preview data.</span>{" "}
        Every number is tagged with its source — click any badge to see where
        it came from. Fixtures are deterministic, so the same filter always
        returns the same numbers; when real pipelines connect, values will
        update and confidence will rise.
      </p>
    </div>
  );
}
