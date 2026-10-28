/** Pure camera maths: world (canvas units) <-> screen (CSS pixels). */

export type Camera = { cx: number; cy: number; scale: number };
export type Viewport = { w: number; h: number; insetTop: number; insetBottom: number };
export type World = { width: number; height: number };

export const MAX_SCALE = 8;

export function fitCamera(world: World, vp: Viewport): Camera {
  const availH = Math.max(100, vp.h - vp.insetTop - vp.insetBottom);
  const scale = Math.min(vp.w / world.width, availH / world.height) * 0.9;
  return {
    cx: world.width / 2,
    cy: world.height / 2 - (vp.insetTop - vp.insetBottom) / 2 / scale,
    scale,
  };
}

export function minScale(world: World, vp: Viewport): number {
  return fitCamera(world, vp).scale * 0.6;
}

/** Keeps the scale in range and some of the canvas on screen. */
export function clampCamera(cam: Camera, world: World, vp: Viewport): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(minScale(world, vp), cam.scale));
  const halfW = vp.w / 2 / scale;
  const halfH = vp.h / 2 / scale;
  const marginX = Math.min(halfW * 0.8, world.width / 2);
  const marginY = Math.min(halfH * 0.8, world.height / 2);
  return {
    scale,
    cx: Math.min(world.width + halfW - marginX, Math.max(-halfW + marginX, cam.cx)),
    cy: Math.min(world.height + halfH - marginY, Math.max(-halfH + marginY, cam.cy)),
  };
}

export function toWorld(cam: Camera, vp: Pick<Viewport, "w" | "h">, sx: number, sy: number) {
  return { x: cam.cx + (sx - vp.w / 2) / cam.scale, y: cam.cy + (sy - vp.h / 2) / cam.scale };
}

export function toScreen(cam: Camera, vp: Pick<Viewport, "w" | "h">, wx: number, wy: number) {
  return { x: (wx - cam.cx) * cam.scale + vp.w / 2, y: (wy - cam.cy) * cam.scale + vp.h / 2 };
}

/** Zoom by `factor` keeping the world point under screen (sx, sy) fixed. */
export function zoomAt(cam: Camera, vp: Pick<Viewport, "w" | "h">, sx: number, sy: number, factor: number): Camera {
  const before = toWorld(cam, vp, sx, sy);
  const scale = cam.scale * factor;
  return {
    scale,
    cx: before.x - (sx - vp.w / 2) / scale,
    cy: before.y - (sy - vp.h / 2) / scale,
  };
}

export function visibleWorld(cam: Camera, vp: Pick<Viewport, "w" | "h">) {
  return {
    minX: cam.cx - vp.w / 2 / cam.scale,
    minY: cam.cy - vp.h / 2 / cam.scale,
    maxX: cam.cx + vp.w / 2 / cam.scale,
    maxY: cam.cy + vp.h / 2 / cam.scale,
  };
}

/** Camera that frames a world rectangle, never zooming closer than `maxScale`. */
export function frameRect(
  r: { minX: number; minY: number; maxX: number; maxY: number },
  vp: Viewport,
  maxScale = 2,
): Camera {
  const w = Math.max(40, r.maxX - r.minX);
  const h = Math.max(40, r.maxY - r.minY);
  const availH = Math.max(100, vp.h - vp.insetTop - vp.insetBottom);
  const scale = Math.min(maxScale, Math.min(vp.w / w, availH / h) * 0.7);
  return {
    cx: (r.minX + r.maxX) / 2,
    cy: (r.minY + r.maxY) / 2 - (vp.insetTop - vp.insetBottom) / 2 / scale,
    scale,
  };
}
