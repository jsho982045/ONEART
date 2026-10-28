import { decodePoints } from "./codec";
import { intersects, seedFor, type BBox, type Stroke } from "./stroke";
import type { FontId, ToolId } from "./tools";

/** Row shape of public.strokes. */
export type StrokeRow = {
  id: number;
  canvas_id: string;
  artist_no: number | null;
  tool: ToolId;
  color: string;
  size: number;
  opacity: number;
  points: string;
  body: string | null;
  font: FontId | null;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  erased: boolean;
  hidden: boolean;
  created_at: string;
};

export const STROKE_COLUMNS =
  "id,canvas_id,artist_no,tool,color,size,opacity,points,body,font,min_x,min_y,max_x,max_y,erased,hidden,created_at";

export function rowToStroke(row: StrokeRow): Stroke {
  const points = row.hidden ? [] : decodePoints(row.points);
  return {
    id: Number(row.id),
    order: Number(row.id),
    artist: row.artist_no == null ? null : Number(row.artist_no),
    tool: row.tool,
    color: row.color,
    size: Number(row.size),
    opacity: Number(row.opacity),
    points,
    body: row.body ?? undefined,
    font: row.font ?? undefined,
    bbox: { minX: Number(row.min_x), minY: Number(row.min_y), maxX: Number(row.max_x), maxY: Number(row.max_y) },
    erased: row.erased,
    hidden: row.hidden,
    seed: points.length ? seedFor(points) : 0,
    createdAt: row.created_at,
  };
}

const CELL = 512;

/**
 * All strokes the viewer knows about, with a coarse spatial index so the renderer can ask
 * "what touches this chunk?" quickly. Insertion order doesn't matter: queries return paint order.
 */
export class StrokeStore {
  private byId = new Map<number, Stroke>();
  private cells = new Map<string, Set<number>>();
  maxConfirmedId = 0;

  get size() {
    return this.byId.size;
  }

  get(id: number) {
    return this.byId.get(id);
  }

  all(): IterableIterator<Stroke> {
    return this.byId.values();
  }

  /** Adds or replaces a stroke. Returns the previous version, if any. */
  put(s: Stroke): Stroke | undefined {
    const prev = this.byId.get(s.id);
    if (prev) this.unindex(prev);
    this.byId.set(s.id, s);
    this.index(s);
    if (s.id > 0 && s.id > this.maxConfirmedId) this.maxConfirmedId = s.id;
    return prev;
  }

  remove(id: number): Stroke | undefined {
    const prev = this.byId.get(id);
    if (!prev) return undefined;
    this.unindex(prev);
    this.byId.delete(id);
    return prev;
  }

  /** Strokes whose bounds touch `b`, in paint order. */
  query(b: BBox): Stroke[] {
    const seen = new Set<number>();
    const out: Stroke[] = [];
    const x0 = Math.floor(b.minX / CELL);
    const x1 = Math.floor(b.maxX / CELL);
    const y0 = Math.floor(b.minY / CELL);
    const y1 = Math.floor(b.maxY / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const set = this.cells.get(`${cx},${cy}`);
        if (!set) continue;
        for (const id of set) {
          if (seen.has(id)) continue;
          seen.add(id);
          const s = this.byId.get(id)!;
          if (intersects(s.bbox, b)) out.push(s);
        }
      }
    }
    out.sort((a, c) => a.order - c.order);
    return out;
  }

  private keys(b: BBox): string[] {
    const keys: string[] = [];
    const x0 = Math.floor(b.minX / CELL);
    const x1 = Math.floor(b.maxX / CELL);
    const y0 = Math.floor(b.minY / CELL);
    const y1 = Math.floor(b.maxY / CELL);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) keys.push(`${cx},${cy}`);
    return keys;
  }

  private index(s: Stroke) {
    for (const k of this.keys(s.bbox)) {
      let set = this.cells.get(k);
      if (!set) this.cells.set(k, (set = new Set()));
      set.add(s.id);
    }
  }

  private unindex(s: Stroke) {
    for (const k of this.keys(s.bbox)) this.cells.get(k)?.delete(s.id);
  }
}
