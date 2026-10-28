import { describe, expect, it } from "vitest";
import { MAX_POINTS, decodePoints, encodePoints, pathLength, quantize } from "./codec";

describe("codec", () => {
  it("round-trips points at quarter-unit precision", () => {
    const pts = [
      { x: 0, y: 0, p: 0 },
      { x: 123.25, y: 456.75, p: 0.5 },
      { x: 11999.9, y: 7999.1, p: 1 },
    ];
    const back = decodePoints(encodePoints(pts));
    expect(back).toHaveLength(3);
    back.forEach((b, i) => {
      expect(Math.abs(b.x - pts[i].x)).toBeLessThanOrEqual(0.125);
      expect(Math.abs(b.y - pts[i].y)).toBeLessThanOrEqual(0.125);
      expect(Math.abs(b.p - pts[i].p)).toBeLessThanOrEqual(1 / 255);
    });
  });

  it("quantize matches what the wire format preserves exactly", () => {
    const pts = [{ x: 10.37, y: 20.91, p: 0.333 }];
    expect(decodePoints(encodePoints(pts))).toEqual(quantize(pts));
  });

  it("uses 5 bytes per point plus a version byte", () => {
    const enc = encodePoints(Array.from({ length: 100 }, (_, i) => ({ x: i, y: i, p: 0.5 })));
    expect(atob(enc).length).toBe(1 + 100 * 5);
  });

  it("clamps out-of-range and non-finite values instead of corrupting the stream", () => {
    const back = decodePoints(encodePoints([{ x: -5, y: 1e9, p: NaN }]));
    expect(back[0].x).toBe(0);
    expect(back[0].y).toBeCloseTo(65535 / 4);
    expect(back[0].p).toBeCloseTo(128 / 255, 2);
  });

  it("refuses empty or oversized strokes", () => {
    expect(() => encodePoints([])).toThrow();
    expect(() => encodePoints(Array.from({ length: MAX_POINTS + 1 }, () => ({ x: 1, y: 1, p: 1 })))).toThrow();
  });

  it("decodes garbage as no points", () => {
    expect(decodePoints("")).toEqual([]);
    expect(decodePoints("%%%")).toEqual([]);
    expect(decodePoints(btoa("\x02abcde"))).toEqual([]);
    expect(decodePoints(btoa("\x01abc"))).toEqual([]);
  });

  it("measures path length", () => {
    expect(pathLength([{ x: 0, y: 0, p: 1 }, { x: 3, y: 4, p: 1 }, { x: 3, y: 10, p: 1 }])).toBe(11);
  });
});
