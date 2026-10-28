import { createCanvas } from "./platform";
import { seeded, noise1 } from "./rng";

/**
 * Procedurally woven, primed cotton-duck canvas. Generated once on the client (no image downloads),
 * identical on every device. Also produces "tooth" masks: dry media (pencil, charcoal) only catch on the
 * raised threads, exactly like a real canvas, and watercolor granulates into the weave.
 */

export const TEX_PX = 256;
/** Thread spacing in texture pixels; 256 / 16 = 16 threads per tile, so the tile repeats seamlessly. */
const PERIOD = 16;
/** One texture tile covers this many canvas units: a fine cotton duck, a thread every 1.75 units. */
export const TEX_WORLD = 28;

export type Textures = {
  surface: HTMLCanvasElement;
  /** Large, low-frequency mottling of the gesso, used when zoomed far out. */
  mottle: HTMLCanvasElement;
  toothHard: HTMLCanvasElement;
  toothSoft: HTMLCanvasElement;
  /** Neutral grey carrying only the weave's light and shadow. Laid over everything with soft-light, so
   * paint sits *in* the weave the way it does on a real canvas instead of floating above it. */
  relief: HTMLCanvasElement;
  surfaceAverage: string;
};

let cached: Textures | null = null;

export function getTextures(): Textures {
  if (cached) return cached;
  const N = TEX_PX;
  const rand = seeded(20261027);
  const rowJ = Array.from({ length: N / PERIOD }, () => 0.82 + rand() * 0.3);
  const colJ = Array.from({ length: N / PERIOD }, () => 0.82 + rand() * 0.3);
  const h = new Float32Array(N * N);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const tx = Math.floor(x / PERIOD);
      const ty = Math.floor(y / PERIOD);
      const fx = (x % PERIOD) / PERIOD;
      const fy = (y % PERIOD) / PERIOD;
      const horizontalOnTop = (tx + ty) % 2 === 0;
      const hp = Math.sin(Math.PI * fy);
      const vp = Math.sin(Math.PI * fx);
      // Each thread dips where it passes under the crossing thread.
      let v = horizontalOnTop
        ? (0.28 + 0.72 * hp * rowJ[ty]) * (0.78 + 0.22 * Math.sin(Math.PI * fx))
        : (0.28 + 0.72 * vp * colJ[tx]) * (0.78 + 0.22 * Math.sin(Math.PI * fy));
      // Slubs (thicker stretches of thread), fibres along the top thread, and fine speckle.
      v *= horizontalOnTop ? 0.9 + 0.2 * noise1(ty * 53 + 11, x / 37) : 0.9 + 0.2 * noise1(tx * 71 + 5, y / 41);
      v += horizontalOnTop ? noise1(ty * 131 + 7, x * 0.35) * 0.07 : noise1(tx * 197 + 3, y * 0.35) * 0.07;
      v += (hash2(x, y) - 0.5) * 0.06;
      h[y * N + x] = v;
    }
  }

  const surface = makeCanvas(N);
  const relief = makeCanvas(N);
  const rl = relief.getContext("2d")!.createImageData(N, N);
  const toothHard = makeCanvas(N);
  const toothSoft = makeCanvas(N);
  const s = surface.getContext("2d")!.createImageData(N, N);
  const th = toothHard.getContext("2d")!.createImageData(N, N);
  const ts = toothSoft.getContext("2d")!.createImageData(N, N);
  // Primed with gesso: the weave shows as gentle relief, not as a pattern.
  const dark = [226, 218, 202];
  const light = [250, 247, 239];
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const v = h[i];
      // Raking light from the top left gives the weave real relief.
      const up = h[((y - 1 + N) % N) * N + ((x - 1 + N) % N)];
      const lit = clamp01(0.62 + (v - up) * 1.6 + (v - 0.55) * 0.45);
      const o = i * 4;
      for (let c = 0; c < 3; c++) s.data[o + c] = dark[c] + (light[c] - dark[c]) * lit;
      s.data[o + 3] = 255;
      const r = 128 + (lit - 0.62) * 105;
      rl.data[o] = rl.data[o + 1] = rl.data[o + 2] = r < 0 ? 0 : r > 255 ? 255 : r;
      rl.data[o + 3] = 255;
      sumR += s.data[o];
      sumG += s.data[o + 1];
      sumB += s.data[o + 2];
      th.data[o] = th.data[o + 1] = th.data[o + 2] = 0;
      // Dry media catch mostly on the raised threads, but never only there.
      // Grain of the gesso on top of the weave, so the tooth never reads as a grid.
      const grain = hash2(x * 3 + 1, y * 5 + 2) * 0.5 + noise1(x * 31 + y, (x + y) * 0.21) * 0.25 + 0.25;
      th.data[o + 3] = 255 * clamp01(0.45 + 0.35 * clamp01((v - 0.3) * 1.7) + (grain - 0.5) * 0.45);
      ts.data[o] = ts.data[o + 1] = ts.data[o + 2] = 0;
      ts.data[o + 3] = 255 * (0.8 + 0.2 * clamp01((v - 0.3) * 1.8));
    }
  }
  surface.getContext("2d")!.putImageData(s, 0, 0);
  relief.getContext("2d")!.putImageData(rl, 0, 0);
  toothHard.getContext("2d")!.putImageData(th, 0, 0);
  toothSoft.getContext("2d")!.putImageData(ts, 0, 0);

  const mottle = makeCanvas(N);
  const m = mottle.getContext("2d")!.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      const n = fbm(x / N, y / N);
      const base = [sumR / (N * N), sumG / (N * N), sumB / (N * N)];
      for (let c = 0; c < 3; c++) m.data[o + c] = base[c] + n * 2.6;
      m.data[o + 3] = 255;
    }
  }
  mottle.getContext("2d")!.putImageData(m, 0, 0);

  const avg = `rgb(${Math.round(sumR / (N * N))},${Math.round(sumG / (N * N))},${Math.round(sumB / (N * N))})`;
  cached = { surface, mottle, toothHard, toothSoft, relief, surfaceAverage: avg };
  return cached;
}

function makeCanvas(n: number): HTMLCanvasElement {
  return createCanvas(n, n);
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Seamless, soft, low-frequency noise on the unit torus: the gentle unevenness of hand-applied gesso. */
function fbm(u: number, v: number): number {
  let total = 0;
  let amp = 0.6;
  const waves = [
    [1, 2, 0.3],
    [3, 1, 1.7],
    [2, 3, 4.1],
    [5, 4, 2.2],
  ];
  for (const [a, b, ph] of waves) {
    total += amp * Math.sin(2 * Math.PI * (a * u + b * v) + ph) * Math.cos(2 * Math.PI * (b * u - a * v) + ph * 0.7);
    amp *= 0.55;
  }
  return total;
}
