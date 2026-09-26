"use client";
// Breeder avatar. Store icons come from MorphMarket's CDN with signed URLs
// that can expire, so a failed image falls back to the breeder's initials.
import { useEffect, useRef, useState } from "react";

export default function Avatar({
  name,
  src,
  size = 48,
}: {
  name: string;
  src: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // An image that failed before hydration never fires onError in React,
  // so check it once on mount too.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-sm font-semibold text-ink-200"
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        // A plain img keeps signed CDN URLs out of the image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
