/**
 * Stroke geometry wire format. MUST match public.draw_stroke() in
 * supabase/migrations/20261027000000_freehand.sql, which decodes it to compute bounds and ink cost.
 *
 *   byte 0          version = 1
 *   per point       x uint16 LE, y uint16 LE  (world units x QUANT), pressure uint8 (0..255)
 *
 * Base64 encoded. 5 bytes per point, so a long 600-point stroke is ~4 KB of base64.
 */

export const CODEC_VERSION = 1;
export const QUANT = 4; // quarter-unit precision
export const MAX_POINTS = 3000;
export const MAX_COORD = 65535 / QUANT;

/** x, y in world units; p is pressure 0..1. */
export type InkPoint = { x: number; y: number; p: number };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function encodePoints(points: InkPoint[]): string {
  if (points.length === 0) throw new Error("empty stroke");
  if (points.length > MAX_POINTS) throw new Error("stroke too long");
  const bytes = new Uint8Array(1 + points.length * 5);
  bytes[0] = CODEC_VERSION;
  let o = 1;
  for (const pt of points) {
    const qx = Math.round(clamp(pt.x, 0, MAX_COORD) * QUANT);
    const qy = Math.round(clamp(pt.y, 0, MAX_COORD) * QUANT);
    const qp = Math.round(clamp(Number.isFinite(pt.p) ? pt.p : 0.5, 0, 1) * 255);
    bytes[o++] = qx & 0xff;
    bytes[o++] = qx >> 8;
    bytes[o++] = qy & 0xff;
    bytes[o++] = qy >> 8;
    bytes[o++] = qp;
  }
  return toBase64(bytes);
}

export function decodePoints(encoded: string): InkPoint[] {
  if (!encoded) return [];
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(encoded);
  } catch {
    return [];
  }
  if (bytes.length < 6 || (bytes.length - 1) % 5 !== 0 || bytes[0] !== CODEC_VERSION) return [];
  const n = (bytes.length - 1) / 5;
  const out: InkPoint[] = new Array(n);
  for (let i = 0, o = 1; i < n; i++, o += 5) {
    out[i] = {
      x: (bytes[o] | (bytes[o + 1] << 8)) / QUANT,
      y: (bytes[o + 2] | (bytes[o + 3] << 8)) / QUANT,
      p: bytes[o + 4] / 255,
    };
  }
  return out;
}

/** Round-trips points through the wire precision, so a local preview matches what everyone else renders. */
export function quantize(points: InkPoint[]): InkPoint[] {
  return points.map((pt) => ({
    x: Math.round(clamp(pt.x, 0, MAX_COORD) * QUANT) / QUANT,
    y: Math.round(clamp(pt.y, 0, MAX_COORD) * QUANT) / QUANT,
    p: Math.round(clamp(Number.isFinite(pt.p) ? pt.p : 0.5, 0, 1) * 255) / 255,
  }));
}

export function pathLength(points: InkPoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
