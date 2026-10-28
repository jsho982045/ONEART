import { paintFootprint, paintStroke } from "./brushes";
import type { Camera } from "./camera";
import { applyOwnership, blockedMask } from "./ownership";
import { createCanvas, now } from "./platform";
import type { StrokeStore } from "./store";
import { intersects, ownerKey, type BBox, type Stroke } from "./stroke";

/**
 * Renders the canvas as a pyramid of 256 px chunks. Each zoom level ("lod") has its own chunks, painted
 * at 2^lod pixels per canvas unit, so zooming never shows blurry paint and zooming out never paints
 * thousands of strokes per frame.
 *
 * Every chunk replays its strokes in paint order through the ownership rule (see ownership.ts), so
 * nobody's paint ever appears on top of somebody else's.
 */

export const CHUNK = 256;
/** Each chunk is painted with a small overlapping border, so scaled chunks never show seams between them. */
const GUTTER = 2;
const SIDE = CHUNK + GUTTER * 2;
export const MIN_LOD = -7;
export const MAX_LOD = 3;
const MAX_CHUNKS = 150;

type Work = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  owners: Int32Array;
  list: Stroke[];
  cursor: number;
  maxOrder: number;
};

type Chunk = {
  key: string;
  lod: number;
  cx: number;
  cy: number;
  /** What's on screen. Kept while a newer version renders, so nothing flickers. */
  front: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    owners: Int32Array;
    maxOrder: number;
    /** Cached "where can't this artist paint" mask, so the first touch of a stroke is instant. */
    blocked: { me: number; canvas: HTMLCanvasElement | null } | null;
  } | null;
  work: Work | null;
  dirty: boolean;
  lastUsed: number;
};

/**
 * Pre-baked overview tiles (made by the tile worker). At these zoom levels the viewer draws the baked
 * image and only paints strokes newer than the bake on top, so it never has to load the whole canvas.
 */
export type TileSource = {
  /** Highest zoom level that has baked tiles (overview levels only). */
  maxLod: number;
  /** Every stroke with order <= baseOrder is already in the tiles. */
  baseOrder: number;
  /** The tile image, or null while it's still downloading (or there's no tile there). */
  get(lod: number, cx: number, cy: number): CanvasImageSource | null;
};

export function lodFor(scalePx: number): number {
  return Math.max(MIN_LOD, Math.min(MAX_LOD, Math.ceil(Math.log2(scalePx) - 1e-9) || 0));
}

export function chunkWorld(lod: number): number {
  return CHUNK / Math.pow(2, lod);
}

function makeCanvas(w: number, h: number, readback = false) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d", readback ? { willReadFrequently: true } : undefined)!;
  return { canvas, ctx };
}

export class ChunkRenderer {
  private chunks = new Map<string, Chunk>();
  private queue: Chunk[] = [];
  private layer = makeCanvas(SIDE, SIDE);
  private mask = makeCanvas(SIDE, SIDE, true);
  private frame = 0;
  private tiles: TileSource | null = null;
  /** Called when a chunk finished rendering and the screen should be redrawn. */
  onChange: () => void = () => {};

  constructor(
    private store: StrokeStore,
    private world: { width: number; height: number },
    /** False while strokes for that area are still loading: avoids painting a half-known region. */
    private regionReady: (b: BBox, lod: number) => boolean,
  ) {}

  setTiles(t: TileSource | null) {
    this.tiles = t;
    // Overview chunks now only hold strokes newer than the bake.
    for (const c of this.chunks.values()) {
      if (this.tiled(c.lod)) {
        c.dirty = true;
        c.work = null;
      }
    }
    this.onChange();
  }

  /** True if this zoom level is covered by baked tiles. */
  tiled(lod: number) {
    return this.tiles != null && lod <= this.tiles.maxLod;
  }

  /** Draws all visible chunks at the right zoom level. Returns true if more work is pending. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, vp: { w: number; h: number }, dpr: number): boolean {
    this.frame++;
    const scalePx = cam.scale * dpr;
    const lod = lodFor(scalePx);
    const cw = chunkWorld(lod);
    const left = cam.cx - vp.w / 2 / cam.scale;
    const top = cam.cy - vp.h / 2 / cam.scale;
    const right = cam.cx + vp.w / 2 / cam.scale;
    const bottom = cam.cy + vp.h / 2 / cam.scale;
    const x0 = Math.max(0, Math.floor(left / cw));
    const y0 = Math.max(0, Math.floor(top / cw));
    const x1 = Math.min(Math.ceil(this.world.width / cw) - 1, Math.floor(right / cw));
    const y1 = Math.min(Math.ceil(this.world.height / cw) - 1, Math.floor(bottom / cw));

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const wanted: Chunk[] = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.get(lod, cx, cy);
        c.lastUsed = this.frame;
        const sx = (cx * cw - left) * scalePx;
        const sy = (cy * cw - top) * scalePx;
        const size = cw * scalePx;
        if (this.tiled(lod)) {
          const img = this.tiles!.get(lod, cx, cy);
          if (img) ctx.drawImage(img, Math.round(sx), Math.round(sy), Math.round(sx + size) - Math.round(sx), Math.round(sy + size) - Math.round(sy));
        }
        if (c.front) {
          // Neighbours share rounded edges exactly: no gaps, and no doubled translucent paint along seams.
          const ax = Math.round(sx);
          const ay = Math.round(sy);
          ctx.drawImage(c.front.canvas, GUTTER, GUTTER, CHUNK, CHUNK, ax, ay, Math.round(sx + size) - ax, Math.round(sy + size) - ay);
        } else if (!this.tiled(lod)) {
          this.drawFallback(ctx, lod, cx, cy, sx, sy, size);
        }
        if (!c.front || c.dirty || c.work) wanted.push(c);
      }
    }
    ctx.restore();

    // Visible work first, nearest the centre first.
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    wanted.sort((a, b) => Math.hypot(a.cx - mx, a.cy - my) - Math.hypot(b.cx - mx, b.cy - my));
    this.queue = wanted;
    this.evict();
    return wanted.length > 0;
  }

  /** Does up to `budgetMs` of rendering. Returns true if anything changed on screen. */
  work(budgetMs: number): boolean {
    const end = now() + budgetMs;
    let changed = false;
    while (this.queue.length && now() < end) {
      const c = this.queue[0];
      const bbox = this.chunkBox(c);
      if (!this.regionReady(bbox, c.lod)) {
        this.queue.shift();
        continue;
      }
      if (!c.work || c.dirty) {
        const { canvas, ctx } = makeCanvas(SIDE, SIDE);
        const base = this.tiled(c.lod) ? this.tiles!.baseOrder : -Infinity;
        c.work = {
          canvas,
          ctx,
          owners: new Int32Array(SIDE * SIDE),
          list: this.store.query(bbox).filter((s) => s.order > base),
          cursor: 0,
          maxOrder: 0,
        };
        c.dirty = false;
      }
      const w = c.work;
      while (w.cursor < w.list.length && now() < end) {
        const s = w.list[w.cursor++];
        if (s.erased || s.hidden || s.points.length === 0) continue;
        this.apply(w.ctx, w.owners, c, s);
        if (s.order > w.maxOrder) w.maxOrder = s.order;
      }
      if (w.cursor >= w.list.length) {
        c.front = { canvas: w.canvas, ctx: w.ctx, owners: w.owners, maxOrder: w.maxOrder, blocked: null };
        c.work = null;
        this.queue.shift();
        changed = true;
      }
    }
    return changed;
  }

  /**
   * A stroke was added or changed. New strokes that come after everything a chunk has painted are
   * simply painted on top (cheap). Anything else re-renders the affected chunks.
   */
  strokeChanged(s: Stroke, kind: "append" | "rebuild") {
    for (const c of this.chunks.values()) {
      if (!intersects(this.chunkBox(c), s.bbox)) continue;
      if (kind === "append" && c.front && !c.work && !c.dirty && s.order > c.front.maxOrder) {
        if (!s.erased && !s.hidden && s.points.length) this.apply(c.front.ctx, c.front.owners, c, s);
        c.front.maxOrder = s.order;
        // Your own paint never blocks you, so your cached mask stays valid after your own strokes.
        if (c.front.blocked && c.front.blocked.me !== ownerKey(s)) c.front.blocked = null;
      } else {
        c.dirty = true;
        c.work = null;
      }
    }
    this.onChange();
  }

  /** A pending stroke got its real id. Re-render only if something confirmed was painted after it. */
  strokeConfirmed(s: Stroke) {
    for (const c of this.chunks.values()) {
      if (!intersects(this.chunkBox(c), s.bbox)) continue;
      const confirmedAfter = this.store
        .query(this.chunkBox(c))
        .some((o) => o.id > 0 && o.id !== s.id && o.order > s.order && !o.erased && !o.hidden);
      if (confirmedAfter) {
        c.dirty = true;
        c.work = null;
      }
    }
    this.onChange();
  }

  invalidateRegion(b: BBox) {
    for (const c of this.chunks.values()) {
      if (intersects(this.chunkBox(c), b)) {
        c.dirty = true;
        c.work = null;
      }
    }
    this.onChange();
  }

  invalidateAll() {
    for (const c of this.chunks.values()) {
      c.dirty = true;
      c.work = null;
    }
    this.onChange();
  }

  /**
   * Screen-sized mask of everything `me` may not paint on, for the stroke being drawn right now.
   * Built once when a stroke starts (the view doesn't move while painting).
   */
  buildBlockedMask(target: CanvasRenderingContext2D, cam: Camera, vp: { w: number; h: number }, dpr: number, me: number) {
    const scalePx = cam.scale * dpr;
    const lod = lodFor(scalePx);
    const cw = chunkWorld(lod);
    const left = cam.cx - vp.w / 2 / cam.scale;
    const top = cam.cy - vp.h / 2 / cam.scale;
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, target.canvas.width, target.canvas.height);
    target.imageSmoothingEnabled = false;
    for (const c of this.visibleFronts(lod, cw, left, top, scalePx, target.canvas.width, target.canvas.height)) {
      const mask = this.blockedFor(c, me);
      if (!mask) continue;
      const size = cw * scalePx;
      target.drawImage(mask, GUTTER, GUTTER, CHUNK, CHUNK, (c.cx * cw - left) * scalePx, (c.cy * cw - top) * scalePx, size, size);
    }
    target.restore();
  }

  /**
   * Builds the blocked masks for what's on screen ahead of time, a little at a time while nothing else is
   * happening, so putting the brush down never has to wait. Returns true if there is more to do.
   */
  prepareBlocked(cam: Camera, vp: { w: number; h: number }, dpr: number, me: number, budgetMs: number): boolean {
    const end = now() + budgetMs;
    const scalePx = cam.scale * dpr;
    const lod = lodFor(scalePx);
    const cw = chunkWorld(lod);
    const left = cam.cx - vp.w / 2 / cam.scale;
    const top = cam.cy - vp.h / 2 / cam.scale;
    for (const c of this.visibleFronts(lod, cw, left, top, scalePx, vp.w * dpr, vp.h * dpr)) {
      if (c.front!.blocked && c.front!.blocked.me === me) continue;
      if (now() > end) return true;
      this.blockedFor(c, me);
    }
    return false;
  }

  private *visibleFronts(lod: number, cw: number, left: number, top: number, scalePx: number, w: number, h: number) {
    for (const c of this.chunks.values()) {
      if (c.lod !== lod || !c.front) continue;
      const sx = (c.cx * cw - left) * scalePx;
      const sy = (c.cy * cw - top) * scalePx;
      const size = cw * scalePx;
      if (sx > w || sy > h || sx + size < 0 || sy + size < 0) continue;
      yield c;
    }
  }

  private blockedFor(c: Chunk, me: number): HTMLCanvasElement | null {
    const f = c.front!;
    if (f.blocked && f.blocked.me === me) return f.blocked.canvas;
    let any = false;
    for (let i = 0; i < f.owners.length; i++) {
      const o = f.owners[i];
      if (o !== 0 && o !== me) {
        any = true;
        break;
      }
    }
    let canvas: HTMLCanvasElement | null = null;
    if (any) {
      const m = makeCanvas(SIDE, SIDE);
      const img = m.ctx.createImageData(SIDE, SIDE);
      blockedMask(f.owners, me, img.data);
      m.ctx.putImageData(img, 0, 0);
      canvas = m.canvas;
    }
    f.blocked = { me, canvas };
    return canvas;
  }

  /**
   * Renders one chunk completely, right now, without its gutter. Used by the tile worker to bake
   * overview tiles with exactly the same painting code as the browser.
   */
  renderChunk(lod: number, cx: number, cy: number): HTMLCanvasElement {
    const c: Chunk = { key: "bake", lod, cx, cy, front: null, work: null, dirty: false, lastUsed: 0 };
    const { canvas, ctx } = makeCanvas(SIDE, SIDE);
    const owners = new Int32Array(SIDE * SIDE);
    for (const s of this.store.query(this.chunkBox(c))) {
      if (s.erased || s.hidden || s.points.length === 0) continue;
      this.apply(ctx, owners, c, s);
    }
    const out = makeCanvas(CHUNK, CHUNK);
    out.ctx.drawImage(canvas, GUTTER, GUTTER, CHUNK, CHUNK, 0, 0, CHUNK, CHUNK);
    return out.canvas;
  }

  // ---- internals ----------------------------------------------------------------------------------

  private apply(ctx: CanvasRenderingContext2D, owners: Int32Array, c: Chunk, s: Stroke) {
    const density = Math.pow(2, c.lod);
    const cw = chunkWorld(c.lod);
    const ox = c.cx * cw - GUTTER / density;
    const oy = c.cy * cw - GUTTER / density;
    const rx = Math.max(0, Math.floor((s.bbox.minX - ox) * density) - 1);
    const ry = Math.max(0, Math.floor((s.bbox.minY - oy) * density) - 1);
    const rx1 = Math.min(SIDE, Math.ceil((s.bbox.maxX - ox) * density) + 1);
    const ry1 = Math.min(SIDE, Math.ceil((s.bbox.maxY - oy) * density) + 1);
    const rw = rx1 - rx;
    const rh = ry1 - ry;
    if (rw <= 0 || rh <= 0) return;

    const L = this.layer.ctx;
    const M = this.mask.ctx;
    for (const g of [L, M]) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(rx, ry, rw, rh);
      g.beginPath();
      g.rect(rx, ry, rw, rh);
      g.clip();
      g.setTransform(density, 0, 0, density, -ox * density, -oy * density);
    }
    paintStroke(L, s, { density });
    paintFootprint(M, s);
    M.restore();

    const fp = M.getImageData(rx, ry, rw, rh);
    const allow = M.createImageData(rw, rh);
    const blocked = applyOwnership(owners, SIDE, rx, ry, rw, rh, ownerKey(s), fp.data, allow.data);
    if (blocked > 0) {
      M.putImageData(allow, rx, ry);
      L.setTransform(1, 0, 0, 1, 0, 0);
      L.globalAlpha = 1;
      L.globalCompositeOperation = "destination-in";
      L.drawImage(this.mask.canvas, rx, ry, rw, rh, rx, ry, rw, rh);
    }
    L.restore();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(this.layer.canvas, rx, ry, rw, rh, rx, ry, rw, rh);
    ctx.restore();
  }

  private drawFallback(ctx: CanvasRenderingContext2D, lod: number, cx: number, cy: number, sx: number, sy: number, size: number) {
    // Borrow a coarser chunk that's already rendered (blurry for a moment beats empty).
    for (let up = 1; lod - up >= MIN_LOD; up++) {
      const f = Math.pow(2, up);
      const pcx = Math.floor(cx / f);
      const pcy = Math.floor(cy / f);
      const p = this.chunks.get(`${lod - up}:${pcx}:${pcy}`);
      if (p?.front) {
        const sub = CHUNK / f;
        ctx.drawImage(p.front.canvas, GUTTER + (cx - pcx * f) * sub, GUTTER + (cy - pcy * f) * sub, sub, sub, sx, sy, size, size);
        p.lastUsed = this.frame;
        return;
      }
    }
  }

  private get(lod: number, cx: number, cy: number): Chunk {
    const key = `${lod}:${cx}:${cy}`;
    let c = this.chunks.get(key);
    if (!c) {
      c = { key, lod, cx, cy, front: null, work: null, dirty: false, lastUsed: this.frame };
      this.chunks.set(key, c);
    }
    return c;
  }

  /** World area a chunk paints, including its gutter. */
  private chunkBox(c: Pick<Chunk, "lod" | "cx" | "cy">): BBox {
    const cw = chunkWorld(c.lod);
    const g = GUTTER / Math.pow(2, c.lod);
    return { minX: c.cx * cw - g, minY: c.cy * cw - g, maxX: (c.cx + 1) * cw + g, maxY: (c.cy + 1) * cw + g };
  }

  private evict() {
    if (this.chunks.size <= MAX_CHUNKS) return;
    const old = [...this.chunks.values()]
      .filter((c) => c.lastUsed < this.frame)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const c of old.slice(0, this.chunks.size - MAX_CHUNKS)) this.chunks.delete(c.key);
  }
}
