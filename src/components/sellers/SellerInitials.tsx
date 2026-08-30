// Deterministic initials avatar. Hashes the seller name into a stable
// gradient stop so the same seller always renders with the same pair
// of hues — gives the directory a varied visual rhythm without
// depending on uploaded photos (we don't have a complete photo set).

const PALETTES: ReadonlyArray<readonly [string, string]> = [
  ["#10b981", "#0ea5e9"], // emerald → sky
  ["#34d399", "#6366f1"], // mint → indigo
  ["#22d3ee", "#10b981"], // cyan → emerald
  ["#84cc16", "#10b981"], // lime → emerald
  ["#a3e635", "#3b82f6"], // limey → blue
  ["#f59e0b", "#10b981"], // amber → emerald
  ["#f97316", "#84cc16"], // orange → lime
  ["#ec4899", "#10b981"], // pink → emerald
  ["#a78bfa", "#22d3ee"], // violet → cyan
  ["#fbbf24", "#34d399"], // amber → mint
];

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

function initialsFor(name: string): string {
  const cleaned = name.trim().replace(/[^\p{L}\p{N}\s']/gu, "");
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function SellerInitials({
  name,
  size = 56,
}: {
  name: string;
  size?: number;
}) {
  const initials = initialsFor(name);
  const [a, b] = PALETTES[djb2(name) % PALETTES.length]!;
  const fontSize = Math.round(size * 0.4);
  return (
    <div
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center font-display font-medium tracking-tight text-ink-950"
      style={{
        width: size,
        height: size,
        borderRadius: size,
        background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
        fontSize,
        // Inner highlight + soft outer ring so the chip reads as
        // intentional rather than a flat colored circle.
        boxShadow: `
          inset 0 1px 0 rgba(255,255,255,0.35),
          inset 0 -2px 6px rgba(0,0,0,0.18),
          0 0 0 1px rgba(255,255,255,0.06),
          0 6px 18px -6px rgba(0,0,0,0.45)
        `,
      }}
    >
      {initials}
    </div>
  );
}
