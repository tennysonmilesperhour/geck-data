// Uniform confidence badge used on every price / index / score throughout
// /market. The numeric score (0..100) is always visible; the tier label
// ("Low", "Medium", "High") is derived from it so callers only set the
// number.
import { tierFor } from "@/lib/market/types";

type Tone = "positive" | "warn" | "danger" | "neutral";

function toneForScore(score: number): Tone {
  if (score >= 80) return "positive";
  if (score >= 50) return "neutral";
  if (score >= 25) return "warn";
  return "danger";
}

// Four distinct tones so the four confidence tiers don't collapse
// visually. Previously neutral (50-79) and warn (25-49) used the same
// busy-amber classes — two distinct meanings rendered identically.
// Neutral now reads as muted ink (the "we have data but it's thin"
// register); warn keeps the clay/amber alarm tone for "this is shaky".
const TONE_CLASSES: Record<Tone, string> = {
  positive: "border-ready/40 bg-ready/10 text-ready",
  neutral:  "border-ink-600 bg-ink-800/70 text-ink-200",
  warn:     "border-busy/40 bg-busy/10 text-busy",
  danger:   "border-danger/40 bg-danger/10 text-danger",
};

export default function ConfidenceBadge({
  score,
  size = "sm",
}: {
  score: number;
  size?: "sm" | "md";
}) {
  const tier = tierFor(score);
  const tone = toneForScore(score);
  const px = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs";
  return (
    <span
      title={`Confidence ${score}/100 — ${tier}. Higher means more observations and tighter agreement across sources behind this number.`}
      className={`inline-flex items-center gap-1 rounded-md border font-mono ${px} ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden>⊘</span>
      <span>
        {tier} · {score}
      </span>
    </span>
  );
}
