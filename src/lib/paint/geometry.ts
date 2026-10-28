import { getStroke, getStrokePoints } from "perfect-freehand";
import type { InkPoint } from "./codec";
import { noise1, seeded } from "./rng";
import { TOOLS, type ToolId } from "./tools";

/**
 * Pure stroke geometry (no canvas): outlines, footprints and bristle tracks.
 * Deterministic: identical input gives identical output on every device. Golden tests guard this.
 */

export type Vec = [number, number];

const SMOOTHING = 0.62;
const STREAMLINE = 0.42;

function toInput(points: InkPoint[]) {
  return points.map((pt) => ({ x: pt.x, y: pt.y, pressure: pt.p }));
}

function optionsFor(tool: ToolId, size: number, last: boolean) {
  const spec = TOOLS[tool];
  const taper = tool === "ink" ? size * 3 : tool === "pencil" ? size * 1.5 : tool === "charcoal" ? size * 1.2 : 0;
  return {
    size,
    thinning: spec.thinning,
    smoothing: SMOOTHING,
    streamline: STREAMLINE,
    simulatePressure: false,
    last,
    start: { taper, cap: true },
    end: { taper, cap: true },
  };
}

/** A tap (or a stroke too short to have a direction) paints a round dab. */
export function isDab(points: InkPoint[], size: number) {
  if (points.length < 2) return true;
  const a = points[0];
  return points.every((p) => Math.abs(p.x - a.x) + Math.abs(p.y - a.y) < Math.max(0.5, size * 0.15));
}

function dab(points: InkPoint[], radius: number): Vec[] {
  const { x, y } = points[0];
  const out: Vec[] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    out.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius]);
  }
  return out;
}

function dabRadius(points: InkPoint[], tool: ToolId, size: number) {
  const p = points.reduce((m, q) => Math.max(m, q.p), 0);
  return Math.max(0.3, size * (0.5 - TOOLS[tool].thinning * (0.5 - p)));
}

/** Closed outline polygon of the painted stroke. */
export function strokeOutline(points: InkPoint[], tool: ToolId, size: number, last = true): Vec[] {
  if (points.length === 0) return [];
  if (isDab(points, size)) return dab(points, dabRadius(points, tool, size));
  return getStroke(toInput(points), optionsFor(tool, size, last)) as Vec[];
}

/**
 * The part of a stroke that "claims" canvas so other artists can't paint over it.
 * Slightly thinner than the visible stroke: that margin is the edge tolerance that lets people
 * draw right up against someone else's work without feeling blocked.
 */
export function footprintOutline(points: InkPoint[], tool: ToolId, size: number): Vec[] {
  if (points.length === 0) return [];
  if (isDab(points, size)) return dab(points, dabRadius(points, tool, size) * TOOLS[tool].footprint);
  return getStroke(toInput(points), {
    ...optionsFor(tool, size * TOOLS[tool].footprint, true),
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  }) as Vec[];
}

export type Bristle = {
  /** Centre-line points. */
  pts: Vec[];
  /** Paint left on the bristle at each point, 0..1 (dry-brush effect). */
  load: number[];
  width: number;
  /** -1..1 tone jitter: some bristles carry slightly lighter or darker paint. */
  tone: number;
};

/**
 * Oil brush: the stroke is painted by many individual bristles. Each one has its own position across
 * the brush, thickness, paint load and slight wander, and runs dry over a long stroke like a real brush.
 */
export function bristleTracks(points: InkPoint[], size: number, opacity: number, seed: number): Bristle[] {
  if (points.length === 0) return [];
  const sp = getStrokePoints(toInput(points), {
    size,
    smoothing: SMOOTHING,
    streamline: STREAMLINE,
    simulatePressure: false,
    last: true,
  });
  const rand = seeded(seed);
  const count = Math.max(8, Math.min(40, Math.round(size / 1.6)));
  const thinning = TOOLS.oil.thinning;
  const dryLength = (700 + size * 22) * (0.6 + 0.4 * opacity);
  const out: Bristle[] = [];

  for (let b = 0; b < count; b++) {
    const across = (b + 0.5) / count - 0.5; // -0.5..0.5 across the brush
    const jitter = (rand() - 0.5) * (0.9 / count);
    const wanderSeed = (seed + b * 7919) >>> 0;
    const loadBase = 0.7 + rand() * 0.6;
    const width = Math.max(0.6, (size / count) * (1.35 + rand() * 0.9));
    const tone = rand() * 2 - 1;
    const pts: Vec[] = [];
    const load: number[] = [];

    for (let i = 0; i < sp.length; i++) {
      const s = sp[i];
      const [vx, vy] = s.vector;
      const nx = -vy;
      const ny = vx;
      const radius = size * Math.max(0.12, 0.5 - thinning * (0.5 - s.pressure));
      const wander = noise1(wanderSeed, s.runningLength / Math.max(6, size * 2.5)) * 0.07;
      const off = (across + jitter + wander) * radius * 2;
      pts.push([s.point[0] + nx * off, s.point[1] + ny * off]);
      const t = s.runningLength / (dryLength * loadBase);
      // Full paint for a while, then the bristle starts to skip and dry out.
      let l = Math.max(0, Math.min(1, 1.12 - t * t));
      if (l < 0.75) {
        const skip = noise1(wanderSeed ^ 0x5bd1e995, s.runningLength / Math.max(3, size * 0.6));
        if (skip > l * 1.9 - 0.75) l *= 0.15;
      }
      load.push(l);
    }
    out.push({ pts, load, width, tone });
  }
  return out;
}

/** Slightly wobbled copy of a polygon: watercolor edges are never perfectly clean. */
export function wobble(poly: Vec[], amount: number, seed: number): Vec[] {
  return poly.map(([x, y], i) => [
    x + noise1(seed, i * 0.31) * amount,
    y + noise1(seed ^ 0x9e3779b9, i * 0.31) * amount,
  ]);
}

/** Axis-aligned bounds of a polygon. */
export function polyBounds(poly: Vec[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Distance from point to the stroke's centre line (for "who painted this?" hit tests). */
export function distanceToPath(points: InkPoint[], x: number, y: number): number {
  if (points.length === 1) return Math.hypot(points[0].x - x, points[0].y - y);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
    if (d < best) best = d;
  }
  return best;
}
