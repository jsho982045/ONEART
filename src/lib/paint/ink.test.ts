import { describe, expect, it } from "vitest";
import { afterStroke, describeWait, inkBalance, secondsUntilPaint, strokeCost } from "./ink";

const settings = { capacity: 1000, refillSeconds: 3600 };

describe("ink well", () => {
  it("a new artist has a full well", () => {
    expect(inkBalance({ ink: null, at: null }, settings, Date.now())).toBe(1000);
  });

  it("refills linearly and never past capacity", () => {
    const t0 = 1_000_000;
    expect(inkBalance({ ink: 0, at: t0 }, settings, t0 + 1800_000)).toBeCloseTo(500);
    expect(inkBalance({ ink: 900, at: t0 }, settings, t0 + 3600_000)).toBe(1000);
  });

  it("a stroke can overdraw the well, but only down to half below zero", () => {
    expect(afterStroke(100, 300, settings)).toBe(-200);
    expect(afterStroke(100, 5000, settings)).toBe(-500);
  });

  it("costs scale with length and size", () => {
    const pts = [{ x: 0, y: 0, p: 1 }, { x: 100, y: 0, p: 1 }];
    expect(strokeCost("ink", 4, pts)).toBe((100 + 4) * 4);
    expect(strokeCost("text", 10, pts, "hello")).toBe(5 * 10 * 10 * 0.5);
  });

  it("tells you how long until you can paint again", () => {
    expect(secondsUntilPaint(10, settings)).toBe(0);
    expect(secondsUntilPaint(-500, settings)).toBeGreaterThan(1800);
    expect(describeWait(30)).toBe("under a minute");
    expect(describeWait(600)).toBe("10 min");
    expect(describeWait(3900)).toBe("1 h 5 min");
  });
});
