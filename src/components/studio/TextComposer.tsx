"use client";

import { useEffect, useRef, useState } from "react";
import { FONTS, type FontId } from "@/lib/paint/tools";

type Props = {
  sx: number;
  sy: number;
  scale: number;
  size: number;
  color: string;
  font: FontId;
  onPlace: (text: string) => void;
  onCancel: () => void;
};

/** Type right on the canvas, in the lettering you chose, then press Place to letter it on for good. */
export function TextComposer(p: Props) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const px = Math.max(16, Math.min(110, p.size * p.scale * FONTS[p.font].scale));

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const place = () => {
    if (text.trim()) p.onPlace(text.trim());
    else p.onCancel();
  };

  return (
    <div className="fixed z-40" style={{ left: Math.max(8, p.sx - 4), top: Math.max(64, p.sy - px * 1.05) }}>
      <input
        ref={input}
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") place();
          if (e.key === "Escape") p.onCancel();
        }}
        placeholder="Write something…"
        aria-label="Your words"
        enterKeyHint="done"
        className="block min-w-[200px] max-w-[calc(100vw-24px)] border-0 border-b-2 border-dashed border-[rgba(60,45,30,.35)] bg-transparent p-0 outline-none placeholder:text-[rgba(60,45,30,.35)]"
        style={{ fontFamily: FONTS[p.font].family, fontSize: px, color: p.color, fontWeight: 400, fontStyle: p.font === "serif" ? "italic" : "normal", width: `${Math.max(8, text.length + 2)}ch` }}
      />
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={place} className="porcelain-btn h-10 btn-ink px-4 text-[14px] font-semibold">
          Letter it
        </button>
        <button type="button" onClick={p.onCancel} className="porcelain-btn h-10 px-4 text-[14px] font-semibold">
          Cancel
        </button>
      </div>
      <p className="mt-1.5 text-[12.5px] text-[#7a6c5c]">{200 - text.length} letters left · lettering is permanent once placed</p>
    </div>
  );
}
