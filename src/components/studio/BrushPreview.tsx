"use client";

import { useEffect, useRef } from "react";
import { paintStroke } from "@/lib/paint/brushes";
import { quantize, type InkPoint } from "@/lib/paint/codec";
import { seedFor, strokeBounds } from "@/lib/paint/stroke";
import { TEX_PX, TEX_WORLD, getTextures } from "@/lib/paint/textures";
import type { FontId, ToolId } from "@/lib/paint/tools";

/** A test swatch painted with the real brush engine on a scrap of the real canvas. */
export function BrushPreview({ tool, color, size, opacity, font }: { tool: ToolId; color: string; size: number; opacity: number; font: FontId }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d")!;
    // Show the brush close to how it looks at 1:1, shrinking big brushes so the swatch still fits.
    const zoom = Math.min(2.2, (h * 0.5) / Math.max(1, size));
    const k = dpr * zoom;

    const tex = getTextures();
    const pat = ctx.createPattern(tex.surface, "repeat");
    if (pat) {
      const t = (TEX_WORLD / TEX_PX) * k;
      pat.setTransform(new DOMMatrix([t, 0, 0, t, 0, 0]));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const ww = w / zoom;
    const wh = h / zoom;
    // Brushes paint on their own transparent layer, which is then laid onto the canvas scrap.
    const layer = document.createElement("canvas");
    layer.width = canvas.width;
    layer.height = canvas.height;
    const lctx = layer.getContext("2d")!;
    lctx.setTransform(k, 0, 0, k, 0, 0);
    const done = () => {
      ctx.drawImage(layer, 0, 0);
      const relief = ctx.createPattern(tex.relief, "repeat");
      if (!relief) return;
      const t = (TEX_WORLD / TEX_PX) * k;
      relief.setTransform(new DOMMatrix([t, 0, 0, t, 0, 0]));
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = relief;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    if (tool === "text") {
      const p = [{ x: ww * 0.08, y: wh * 0.68, p: 0.5 }];
      const body = "Hello, world";
      paintStroke(lctx, { tool, color, size, opacity, font, body, points: p, seed: 1, bbox: strokeBounds(tool, size, p, body) }, { density: k });
      done();
      return;
    }
    const pts: InkPoint[] = [];
    const n = 90;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({
        x: ww * (0.1 + 0.8 * t),
        y: wh * (0.5 + Math.sin(t * Math.PI * 2) * 0.22),
        p: 0.35 + 0.6 * Math.sin(t * Math.PI),
      });
    }
    const q = quantize(pts);
    paintStroke(lctx, { tool, color, size, opacity, font, points: q, seed: seedFor(q), bbox: strokeBounds(tool, size, q) }, { density: k });
    done();
  }, [tool, color, size, opacity, font]);

  return (
    <canvas
      ref={ref}
      className="h-[84px] w-full rounded-xl shadow-[inset_0_1px_3px_rgba(60,40,20,.25)]"
      aria-label="Preview of your brush"
      role="img"
    />
  );
}
