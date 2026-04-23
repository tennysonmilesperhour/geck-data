"use client";
import { useEffect, useRef, useState } from "react";

// Geck Inspect brand mark. Expects public/geck-logo.png (transparent PNG
// preferred). If the asset is missing or fails to load, falls back to the
// Claude-Code-style asterisk so the page never shows a broken-image icon.
//
// The useEffect double-checks the image post-mount: if the <img> already
// finished loading before React hydration (and failed — naturalWidth===0),
// the onError event never reaches React. We detect that state and flip to
// the fallback manually.
export default function Logo({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      setFailed(true);
    }
  }, []);

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
      ref={imgRef}
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
