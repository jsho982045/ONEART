import { beforeAll, describe, expect, it } from "vitest";
import { DOMMatrix, Path2D, createCanvas, type Canvas } from "@napi-rs/canvas";
import { encodePoints } from "./codec";
import { setCanvasFactory } from "./platform";
import { ChunkRenderer, lodFor } from "./renderer";
import { StrokeStore, rowToStroke, type StrokeRow } from "./store";
import { strokeBounds } from "./stroke";
import type { ToolId } from "./tools";

/** The real renderer, painting with a server-side canvas: proves what people actually see. */
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.Path2D = Path2D;
  g.DOMMatrix = DOMMatrix;
  setCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
});

let nextId = 1;
function stroke(artist: number, color: string, pts: [number, number][], tool: ToolId = "ink", size = 20): StrokeRow {
  const points = pts.map(([x, y]) => ({ x, y, p: 0.6 }));
  const b = strokeBounds(tool, size, points);
  return {
    id: nextId++,
    canvas_id: "c",
    artist_no: artist,
    tool,
    color,
    size,
    opacity: 1,
    points: encodePoints(points),
    body: null,
    font: null,
    min_x: b.minX,
    min_y: b.minY,
    max_x: b.maxX,
    max_y: b.maxY,
    erased: false,
    hidden: false,
    created_at: "",
  };
}

const line = (x0: number, y0: number, x1: number, y1: number, n = 30): [number, number][] =>
  Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1)]);

function pixel(c: Canvas, x: number, y: number) {
  const d = c.getContext("2d").getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

describe("renderer", () => {
  const world = { width: 4000, height: 4000 };

  it("earlier paint by someone else always stays on top of later paint", () => {
    const store = new StrokeStore();
    store.put(rowToStroke(stroke(1, "#0000ff", line(20, 128, 236, 128)))); // horizontal, first
    store.put(rowToStroke(stroke(2, "#ffff00", line(128, 20, 128, 236)))); // vertical, later, other artist
    const tile = new ChunkRenderer(store, world, () => true).renderChunk(0, 0, 0) as unknown as Canvas;
    const [r, g, b] = pixel(tile, 128, 128);
    expect(b).toBeGreaterThan(200);
    expect(r).toBeLessThan(60);
    expect(g).toBeLessThan(60);
    // Away from the crossing, the later stroke is there as normal.
    const [r2, g2] = pixel(tile, 128, 60);
    expect(r2).toBeGreaterThan(200);
    expect(g2).toBeGreaterThan(200);
  });

  it("you can paint over your own work", () => {
    const store = new StrokeStore();
    store.put(rowToStroke(stroke(3, "#0000ff", line(20, 128, 236, 128))));
    store.put(rowToStroke(stroke(3, "#ffff00", line(128, 20, 128, 236))));
    const tile = new ChunkRenderer(store, world, () => true).renderChunk(0, 0, 0) as unknown as Canvas;
    const [r, g, b] = pixel(tile, 128, 128);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(200);
    expect(b).toBeLessThan(80);
  });

  it("the result doesn't depend on which chunk paints the crossing (no seams in the rule)", () => {
    const store = new StrokeStore();
    store.put(rowToStroke(stroke(1, "#0000ff", line(100, 256, 412, 256))));
    store.put(rowToStroke(stroke(2, "#ffff00", line(256, 100, 256, 412))));
    const r = new ChunkRenderer(store, world, () => true);
    // The crossing sits on the corner of four chunks; each must agree.
    for (const [cx, cy, px, py] of [
      [0, 0, 255, 255],
      [1, 0, 0, 255],
      [0, 1, 255, 0],
      [1, 1, 0, 0],
    ] as const) {
      const [, , b] = pixel(r.renderChunk(0, cx, cy) as unknown as Canvas, px, py);
      expect(b).toBeGreaterThan(200);
    }
  });

  it("erased and hidden strokes are not painted", () => {
    const store = new StrokeStore();
    store.put(rowToStroke({ ...stroke(1, "#ff0000", line(20, 128, 236, 128)), erased: true }));
    store.put(rowToStroke({ ...stroke(1, "#ff0000", line(20, 60, 236, 60)), hidden: true, points: "" }));
    const tile = new ChunkRenderer(store, world, () => true).renderChunk(0, 0, 0) as unknown as Canvas;
    expect(pixel(tile, 128, 128)[3]).toBe(0);
    expect(pixel(tile, 128, 60)[3]).toBe(0);
  });

  it("picks the zoom level that never upscales paint", () => {
    expect(lodFor(1)).toBe(0);
    expect(lodFor(1.01)).toBe(1);
    expect(lodFor(0.3)).toBe(-1);
    expect(lodFor(100)).toBe(3);
    expect(lodFor(1e-6)).toBe(-7);
  });
});
