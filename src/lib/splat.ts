/**
 * Deterministic splat generator.
 *
 * Users never choose how their mark looks. The database stores only a random
 * `seed` (generated server-side inside place_splat) and this function turns that
 * seed into a shape, size, rotation and color. Same seed => same splat, on any
 * client or server, forever.
 *
 * IMPORTANT: the order of rand() calls below is part of the data format. If you
 * change anything that alters existing output, bump ALGO_VERSION and keep the old
 * implementation around for rows stored with the old version.
 */

export const ALGO_VERSION = 1;

/** Radius range of the main blob in world units (canvas is 5000 wide). */
export const SIZE_MIN = 24;
export const SIZE_MAX = 210;

const TAU = Math.PI * 2;

export type Splat = {
  seed: number;
  /** Radius of the main blob in world units. */
  size: number;
  /** Radians. */
  rotation: number;
  /** CSS color, e.g. "hsl(212 71.3% 52.4%)". */
  color: string;
  /** SVG path data in unit space (main blob radius is roughly 1). */
  path: string;
  /** Farthest distance from the origin in unit space. Multiply by size for culling. */
  extent: number;
};

type Pt = { x: number; y: number };

/** mulberry32: tiny, fast, well-distributed seeded PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blobPoints(
  rand: () => number,
  count: number,
  roughness: number,
  lobeAmplitude: number,
  cx: number,
  cy: number,
  radius: number,
): Pt[] {
  const lobeFreq = 2 + Math.floor(rand() * 3); // 2..4 broad lobes
  const lobePhase = rand() * TAU;
  const step = TAU / count;
  const points: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const angle = i * step + (rand() - 0.5) * step * 0.6;
    const r =
      radius *
      (1 + (rand() - 0.5) * roughness + lobeAmplitude * Math.sin(lobeFreq * angle + lobePhase));
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return points;
}

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** Closed Catmull-Rom spline, converted to cubic beziers. */
function closedSplinePath(p: Pt[]): string {
  const n = p.length;
  let d = `M${f(p[0].x)} ${f(p[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n];
    const p1 = p[i];
    const p2 = p[(i + 1) % n];
    const p3 = p[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d + "Z";
}

export function generateSplat(seed: number): Splat {
  const rand = mulberry32(seed);

  // 1. Color: any hue, but saturation and lightness stay in a vibrant band so a
  //    canvas full of overlapping splats never turns to mud.
  const hue = Math.floor(rand() * 360);
  const sat = 55 + rand() * 30; // 55-85%
  const light = 45 + rand() * 20; // 45-65%
  const color = `hsl(${hue} ${sat.toFixed(1)}% ${light.toFixed(1)}%)`;

  // 2. Size: cubic weighting, so most splats are modest and big ones are rare.
  const u = rand();
  const size = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * u * u * u;

  // 3. Orientation.
  const rotation = rand() * TAU;

  // 4. Main body.
  const vertexCount = 6 + Math.floor(rand() * 7); // 6..12
  const roughness = 0.35 + rand() * 0.35;
  const lobeAmplitude = 0.1 + rand() * 0.2;
  const body = blobPoints(rand, vertexCount, roughness, lobeAmplitude, 0, 0, 1);
  let path = closedSplinePath(body);
  let extent = 0;
  for (const pt of body) extent = Math.max(extent, Math.hypot(pt.x, pt.y));

  // 5. Satellite droplets (0..4) flung out from the body.
  const droplets = Math.floor(rand() * 5);
  for (let i = 0; i < droplets; i++) {
    const angle = rand() * TAU;
    const dist = 1.3 + rand() * 0.9;
    const radius = 0.07 + rand() * 0.15;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const drop = blobPoints(rand, 7, 0.3, 0.08, dx, dy, radius);
    path += closedSplinePath(drop);
    for (const pt of drop) extent = Math.max(extent, Math.hypot(pt.x, pt.y));
  }

  return { seed, size, rotation, color, path, extent: extent * 1.1 };
}
