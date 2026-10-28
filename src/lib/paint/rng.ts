/** Small, fast, deterministic randomness: the same stroke must look identical on every screen, forever. */

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: returns a function giving floats in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise in [-1, 1] keyed by a seed, for wobbly watercolor edges and bristle drift. */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = lattice(seed, i);
  const b = lattice(seed, i + 1);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

function lattice(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i, 0x27d4eb2d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
