"use client";
import { useState } from "react";

// Geck Inspect brand mark. Expects public/geck-logo.png (transparent PNG
// preferred). If the asset is missing, falls back to the Claude-Code-style
// asterisk so the Header never renders a broken image.
export default function Logo({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-label="Geck Inspect"
        className={`claude-star leading-none ${className}`}
        style={{ fontSize: Math.round(size * 0.9) }}
      >
        ✷
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/geck-logo.png"
      alt="Geck Inspect"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
