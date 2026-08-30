"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import SellerInitials from "@/components/sellers/SellerInitials";

export default function SellerAvatar({
  name,
  imageUrl,
  size = 56,
  priority = false,
}: {
  name: string;
  imageUrl?: string | null;
  size?: number;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [imageUrl]);

  if (!imageUrl || failed) {
    return <SellerInitials name={name} size={size} />;
  }

  return (
    <span
      className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-ink-600 bg-ink-900 shadow-[0_6px_18px_-8px_rgba(0,0,0,0.65)]"
      style={{ width: size, height: size }}
      title="Marketplace profile image"
    >
      <Image
        src={imageUrl}
        alt={`${name} marketplace profile image`}
        fill
        sizes={`${size}px`}
        className="object-cover"
        priority={priority}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
