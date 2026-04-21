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

const TONE_CLASSES: Record<Tone, string> = {
  positive: "border-ready/40 bg-ready/10 text-ready",
  neutral:  "border-busy/40 bg-busy/10 text-busy",
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
      title={`Confidence ${score}/100 — ${tier}`}
      className={`inline-flex items-center gap-1 rounded-md border font-mono ${px} ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden>⊘</span>
      <span>
        {tier} · {score}
      </span>
    </span>
  );
}
