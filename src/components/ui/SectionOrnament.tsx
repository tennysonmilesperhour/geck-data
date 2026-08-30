// Section break. A thin slate hairline-rule with a small geometric mark in
// the middle. Use between major sections of a page when you want a visual
// breath; do not stack adjacent to a SectionHeader.
//
// The old field-guide leaf motif was dropped when the app moved to the
// Market Analytics slate theme: the mark is now a neutral dot/diamond, in
// keeping with the quiet rules the preview uses between sections. The
// hairlines come from globals.css (.ornament-rule); this component only
// provides the wrapper + the centre glyph.

export type SectionOrnamentVariant = "leaf" | "diamond" | "circle";

const GLYPHS: Record<SectionOrnamentVariant, JSX.Element> = {
  leaf: (
    // Neutral small dot. (The name is kept so existing callers compile; the
    // botanical leaf it used to draw is gone with the field-guide theme.)
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className="shrink-0">
      <circle cx="4" cy="4" r="2" fill="currentColor" />
    </svg>
  ),
  diamond: (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="shrink-0">
      <path
        d="M5 1 L 9 5 L 5 9 L 1 5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  ),
  circle: (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="shrink-0">
      <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
};

export default function SectionOrnament({
  variant = "leaf",
  className = "",
}: {
  variant?: SectionOrnamentVariant;
  className?: string;
}) {
  return (
    <div role="presentation" className={`ornament-rule my-6 ${className}`}>
      {GLYPHS[variant]}
    </div>
  );
}
