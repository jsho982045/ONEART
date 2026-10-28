import { describe, expect, it } from "vitest";
import { MAX_SCALE, clampCamera, fitCamera, frameRect, toScreen, toWorld, zoomAt } from "./camera";

const world = { width: 12000, height: 8000 };
const vp = { w: 390, h: 844, insetTop: 64, insetBottom: 120 };

describe("camera", () => {
  it("fits the whole canvas on a phone", () => {
    const c = fitCamera(world, vp);
    const tl = toScreen(c, vp, 0, 0);
    const br = toScreen(c, vp, world.width, world.height);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(vp.w);
    expect(tl.y).toBeGreaterThanOrEqual(vp.insetTop - 1);
    expect(br.y).toBeLessThanOrEqual(vp.h - vp.insetBottom + 1);
  });

  it("screen and world conversions are inverses", () => {
    const c = { cx: 3000, cy: 2000, scale: 1.7 };
    const w = toWorld(c, vp, 123, 456);
    const s = toScreen(c, vp, w.x, w.y);
    expect(s.x).toBeCloseTo(123);
    expect(s.y).toBeCloseTo(456);
  });

  it("zooming keeps the point under your fingers still", () => {
    const c = { cx: 3000, cy: 2000, scale: 1 };
    const before = toWorld(c, vp, 100, 600);
    const after = toWorld(zoomAt(c, vp, 100, 600, 2.5), vp, 100, 600);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("can't zoom past the limits or fling the canvas off screen", () => {
    expect(clampCamera({ cx: 0, cy: 0, scale: 1000 }, world, vp).scale).toBe(MAX_SCALE);
    expect(clampCamera({ cx: 0, cy: 0, scale: 1e-9 }, world, vp).scale).toBeGreaterThan(0);
    const far = clampCamera({ cx: -1e6, cy: 1e6, scale: 1 }, world, vp);
    expect(far.cx).toBeGreaterThan(-vp.w);
    expect(far.cy).toBeLessThan(world.height + vp.h);
  });

  it("frames a region without zooming in absurdly close", () => {
    const c = frameRect({ minX: 100, minY: 100, maxX: 101, maxY: 101 }, vp, 2);
    expect(c.scale).toBeLessThanOrEqual(2);
  });
});
