"use client";

import { useState } from "react";

/**
 * The finished piece, framed, for looking at. The image itself is a reduced, watermarked preview (the real
 * file never leaves the server until someone buys it); this component also discourages saving it:
 * no right-click, no drag, no long-press menu, and a tap-to-zoom loupe instead of the browser's.
 */
export function ProtectedPreview({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };

  return (
    <figure className="relative">
      <div className="rounded-[6px] bg-[linear-gradient(145deg,#6b4a2c,#3d2817_55%,#5a3c22)] p-[clamp(10px,2.2vw,22px)] shadow-[0_30px_60px_rgba(40,25,10,.35),inset_0_1px_0_rgba(255,230,190,.35)]">
        <div
          className="relative touch-pan-y select-none overflow-hidden bg-[#f3eee4] shadow-[inset_0_2px_8px_rgba(0,0,0,.35)]"
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          onPointerMove={(e) => e.pointerType === "mouse" && move(e)}
          onPointerDown={(e) => e.pointerType !== "mouse" && (zoom ? setZoom(null) : move(e))}
          onPointerLeave={(e) => e.pointerType === "mouse" && setZoom(null)}
          style={{ WebkitTouchCallout: "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="pointer-events-none block w-full transition-transform duration-200"
            style={zoom ? { transform: "scale(2.2)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
          />
          <div className="pointer-events-none absolute inset-0" aria-hidden />
        </div>
      </div>
      <figcaption className="mt-3 text-center text-[13px] text-[#7a6c5c]">Preview. Tap or hover to look closer.</figcaption>
    </figure>
  );
}
