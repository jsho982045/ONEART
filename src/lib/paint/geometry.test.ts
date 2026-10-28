import { describe, expect, it } from "vitest";
import type { InkPoint } from "./codec";
import { bristleTracks, distanceToPath, footprintOutline, polyBounds, strokeOutline, wobble } from "./geometry";
import { hashString } from "./rng";

const curve: InkPoint[] = Array.from({ length: 60 }, (_, i) => ({
  x: 100 + i * 5,
  y: 200 + Math.sin(i / 8) * 40,
  p: 0.4 + 0.5 * Math.sin((i / 59) * Math.PI),
}));

const digest = (poly: [number, number][]) => hashString(poly.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(";"));

describe("stroke geometry", () => {
  it("is deterministic: the same stroke looks the same on every screen", () => {
    expect(digest(strokeOutline(curve, "oil", 20))).toBe(digest(strokeOutline(curve, "oil", 20)));
    expect(digest(wobble(strokeOutline(curve, "watercolor", 30), 2, 42))).toBe(digest(wobble(strokeOutline(curve, "watercolor", 30), 2, 42)));
    const a = bristleTracks(curve, 24, 1, 99);
    const b = bristleTracks(curve, 24, 1, 99);
    expect(a).toEqual(b);
  });

  it("outlines stay close to the path", () => {
    const b = polyBounds(strokeOutline(curve, "ink", 10));
    expect(b.minX).toBeGreaterThan(100 - 10);
    expect(b.maxX).toBeLessThan(100 + 59 * 5 + 10);
  });

  it("the claimed footprint is inside the painted stroke (that margin is the tolerance)", () => {
    const paint = polyBounds(strokeOutline(curve, "oil", 40));
    const claim = polyBounds(footprintOutline(curve, "oil", 40));
    expect(claim.minY).toBeGreaterThan(paint.minY);
    expect(claim.maxY).toBeLessThan(paint.maxY);
  });

  it("an oil brush has a sensible number of bristles that carry paint and then run dry", () => {
    const long: InkPoint[] = Array.from({ length: 400 }, (_, i) => ({ x: 50 + i * 8, y: 300, p: 0.7 }));
    const bristles = bristleTracks(long, 30, 1, 7);
    expect(bristles.length).toBeGreaterThanOrEqual(8);
    expect(bristles.length).toBeLessThanOrEqual(40);
    for (const br of bristles) {
      expect(br.pts.length).toBe(br.load.length);
      expect(br.load.every((l) => l >= 0 && l <= 1)).toBe(true);
      expect(br.load[0]).toBeGreaterThan(0.9);
    }
    const tailLoad = bristles.reduce((s, br) => s + br.load[br.load.length - 1], 0) / bristles.length;
    expect(tailLoad).toBeLessThan(0.5);
  });

  it("a single tap paints a round dab, and claims a slightly smaller one", () => {
    const tap = [{ x: 10, y: 10, p: 0.5 }];
    const dot = strokeOutline(tap, "pencil", 4);
    expect(dot.length).toBeGreaterThanOrEqual(12);
    const r = polyBounds(dot);
    expect(r.maxX - r.minX).toBeCloseTo(r.maxY - r.minY, 1);
    expect(r.maxX - r.minX).toBeGreaterThan(1);
    const claim = polyBounds(footprintOutline(tap, "pencil", 4));
    expect(claim.maxX - claim.minX).toBeLessThan(r.maxX - r.minX);
    // A shaky tap (tiny wiggle) is still a dab, not a smear.
    expect(strokeOutline([...tap, { x: 10.25, y: 10, p: 0.5 }], "pencil", 4).length).toBe(dot.length);
  });

  it("measures distance to the brush path for hit tests", () => {
    const line: InkPoint[] = [
      { x: 0, y: 0, p: 1 },
      { x: 10, y: 0, p: 1 },
    ];
    expect(distanceToPath(line, 5, 3)).toBe(3);
    expect(distanceToPath(line, -4, 3)).toBe(5);
    expect(distanceToPath([{ x: 1, y: 1, p: 1 }], 4, 5)).toBe(5);
  });
});
