import { describe, expect, it } from "vitest";
import { BRUSH_ORDER, PIGMENTS, TOOLS, isHexColor } from "./tools";

describe("tools and pigments", () => {
  it("every tool's defaults are inside its own range and inside the database limits", () => {
    for (const t of BRUSH_ORDER) {
      const s = TOOLS[t];
      expect(s.defaultSize).toBeGreaterThanOrEqual(s.minSize);
      expect(s.defaultSize).toBeLessThanOrEqual(s.maxSize);
      expect(s.minSize).toBeGreaterThanOrEqual(0.5);
      expect(s.maxSize).toBeLessThanOrEqual(400);
      expect(s.defaultOpacity).toBeGreaterThanOrEqual(0.05);
      expect(s.defaultOpacity).toBeLessThanOrEqual(1);
      expect(s.footprint).toBeGreaterThan(0.5);
      expect(s.footprint).toBeLessThan(1);
    }
  });

  it("every pigment is a lowercase hex the database accepts, and names are unique", () => {
    for (const p of PIGMENTS) expect(isHexColor(p.hex)).toBe(true);
    expect(new Set(PIGMENTS.map((p) => p.name)).size).toBe(PIGMENTS.length);
    expect(new Set(PIGMENTS.map((p) => p.hex)).size).toBe(PIGMENTS.length);
  });
});
