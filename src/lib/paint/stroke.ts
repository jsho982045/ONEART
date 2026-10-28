import { encodePoints, type InkPoint } from "./codec";
import { hashString } from "./rng";
import type { FontId, ToolId } from "./tools";

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

/** A stroke as the renderer sees it. */
export type Stroke = {
  /** Server id. Unconfirmed local strokes use a temporary negative id. */
  id: number;
  /** Paint order. Server id for confirmed strokes; pending ones sort after everything. */
  order: number;
  /** Public artist number. null if the account was deleted. */
  artist: number | null;
  tool: ToolId;
  color: string;
  size: number;
  opacity: number;
  points: InkPoint[];
  body?: string;
  font?: FontId;
  bbox: BBox;
  erased: boolean;
  hidden: boolean;
  /** Deterministic randomness for this stroke's texture. */
  seed: number;
  createdAt: string;
};

/** Mirrors the bounds draw_stroke() stores, so local strokes are indexed exactly like confirmed ones. */
export function strokeBounds(tool: ToolId, size: number, points: InkPoint[], body?: string): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (tool === "text") {
    return {
      minX: minX - size * 0.2,
      minY: minY - size * 1.1,
      maxX: minX + (body?.length ?? 0) * size * 0.75 + size,
      maxY: maxY + size * 0.45,
    };
  }
  return { minX: minX - size, minY: minY - size, maxX: maxX + size, maxY: maxY + size };
}

/**
 * Texture seed: from the first few points only, so a stroke looks the same while it is being painted
 * as after it is saved (encoding quantizes, so raw and saved points hash identically).
 */
export function seedFor(points: InkPoint[]): number {
  if (!points.length) return 0;
  return hashString(encodePoints(points.slice(0, 4)));
}

/** The key that "owns" canvas for the no-overpainting rule. Deleted accounts keep their ink protected. */
export function ownerKey(s: Pick<Stroke, "artist" | "id">): number {
  return s.artist != null ? s.artist : -Math.abs(s.id) - 1;
}

export function intersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
