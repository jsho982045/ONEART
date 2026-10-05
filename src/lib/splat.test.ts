import { describe, expect, it } from "vitest";
import { ALGO_VERSION, SIZE_MAX, SIZE_MIN, generateSplat } from "./splat";

describe("generateSplat", () => {
  it("is deterministic: same seed, identical output", () => {
    for (const seed of [0, 1, 42, 123456789, 4294967295]) {
      expect(generateSplat(seed)).toEqual(generateSplat(seed));
    }
  });

  it("differs between seeds", () => {
    const paths = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) paths.add(generateSplat(seed).path);
    expect(paths.size).toBe(200);
  });

  it("keeps size, color and rotation inside their documented ranges", () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const s = generateSplat(seed * 2654435761);
      expect(s.size).toBeGreaterThanOrEqual(SIZE_MIN);
      expect(s.size).toBeLessThanOrEqual(SIZE_MAX);
      expect(s.rotation).toBeGreaterThanOrEqual(0);
      expect(s.rotation).toBeLessThan(Math.PI * 2);

      const m = /^hsl\((\d+) ([\d.]+)% ([\d.]+)%\)$/.exec(s.color);
      expect(m).not.toBeNull();
      const [, h, sat, light] = m!;
      expect(Number(h)).toBeGreaterThanOrEqual(0);
      expect(Number(h)).toBeLessThan(360);
      expect(Number(sat)).toBeGreaterThanOrEqual(55);
      expect(Number(sat)).toBeLessThanOrEqual(85);
      expect(Number(light)).toBeGreaterThanOrEqual(45);
      expect(Number(light)).toBeLessThanOrEqual(65);
    }
  });

  it("produces closed, valid-looking SVG paths and a sane extent", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const s = generateSplat(seed);
      expect(s.path.startsWith("M")).toBe(true);
      expect(s.path.endsWith("Z")).toBe(true);
      expect(s.path).not.toMatch(/NaN|Infinity/);
      expect(s.extent).toBeGreaterThan(0.9);
      expect(s.extent).toBeLessThan(3.5);
    }
  });

  it("weights toward smaller splats", () => {
    let small = 0;
    const n = 4000;
    const mid = SIZE_MIN + (SIZE_MAX - SIZE_MIN) / 2;
    for (let seed = 1; seed <= n; seed++) {
      if (generateSplat(seed * 40503).size < mid) small++;
    }
    expect(small / n).toBeGreaterThan(0.7);
  });

  it("is on algorithm version 1 (bump deliberately if output changes)", () => {
    expect(ALGO_VERSION).toBe(1);
  });

  // Golden values. If any of these fail, stored marks would change appearance:
  // revert the change, or bump ALGO_VERSION and keep the old generator for old rows.
  it("matches hard-coded golden output for known seeds", () => {
    const a = generateSplat(1);
    expect(a.color).toBe("hsl(225 55.1% 55.5%)");
    expect(a.size).toBeCloseTo(199.6255330497, 8);
    expect(a.rotation).toBeCloseTo(6.0844977819, 8);
    expect(a.path.length).toBe(867);
    expect(a.path.startsWith("M0.968 -0.023C1.044 0.259 1.054 0.651 0.884 0.75C0.715 0.848")).toBe(true);

    const b = generateSplat(42);
    expect(b.color).toBe("hsl(216 68.4% 62.0%)");
    expect(b.size).toBeCloseTo(79.8753254917, 8);
    expect(b.path.length).toBe(899);

    const c = generateSplat(123456789);
    expect(c.color).toBe("hsl(92 84.1% 60.7%)");
    expect(c.size).toBeCloseTo(25.6298780232, 8);
    expect(c.path.length).toBe(723);
  });
});
