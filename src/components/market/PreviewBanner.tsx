// Amber "preview data" banner shown at the top of /market while real
// pipelines are still being wired. Forest-themed: yellow copy on a subtle
// amber-tinted emerald surface so it reads as "caution but on-brand".
export default function PreviewBanner() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-busy/50 bg-gradient-to-r from-busy/[0.08] via-busy/[0.05] to-transparent px-4 py-3 text-sm shadow-[0_0_0_1px_rgba(251,191,36,0.06)]">
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-busy/60 text-xs font-semibold text-busy"
      >
        !
      </span>
      <p className="leading-5 text-forest-200">
        <span className="font-semibold text-busy">Preview data.</span>{" "}
        Every number is tagged with its source — click any badge to see where
        it came from. Fixtures are deterministic, so the same filter always
        returns the same numbers; when real pipelines connect, values will
        update and confidence will rise.
      </p>
    </div>
  );
}
