"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export default function ListingImage({
  src,
  alt,
  className = "",
  sizes = "96px",
  priority = false,
  label,
  showFallback = true,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  label?: string;
  showFallback?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if ((!src || failed) && !showFallback) return null;

  return (
    <span
      className={`relative block overflow-hidden border border-ink-700 bg-ink-900 ${className}`}
    >
      {src && !failed ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className="object-cover transition duration-300 group-hover:scale-[1.035]"
          priority={priority}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(135deg,rgba(16,185,129,0.08),rgba(15,23,42,0.65))] px-2 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-ink-500">
          No catalog image
        </span>
      )}
      {label && src && !failed ? (
        <span className="absolute bottom-1.5 left-1.5 rounded-sm border border-black/20 bg-black/65 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-white/90 backdrop-blur-sm">
          {label}
        </span>
      ) : null}
    </span>
  );
}
