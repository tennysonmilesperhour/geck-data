// Field-guide section break. Renders a thin hairline-rule with a small
// botanical glyph in the middle. Use between major sections of a page
// when you want a visual breath; do not stack adjacent to a
// SectionHeader — the eyebrow already does that work.
//
// The hairlines come from globals.css (.ornament-rule). This component
// only provides the markup wrapper + the center glyph SVG so the
// shape stays consistent everywhere.

export type SectionOrnamentVariant = "leaf" | "diamond" | "circle";

const GLYPHS: Record<SectionOrnamentVariant, JSX.Element> = {
  leaf: (
    // Single stylised leaf, drawn at 14x14. Stroke uses currentColor
    // so the ornament-rule .clay tone applies.
    <svg
      width="16"
      height="14"
      viewBox="0 0 16 14"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M2 7 C 4 2, 10 2, 14 7 C 10 12, 4 12, 2 7 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 7 L 14 7"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
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
